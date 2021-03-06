import * as cronstrue from "cronstrue";
import * as _ from "lodash";
import { Context } from "../../context";
import { Stores } from "../../schema/stores";
import { VeleroClient } from "./veleroClient";
import { ReplicatedError } from "../../server/errors";
import {
  kotsAppIdKey,
  kotsAppSequenceKey,
  kotsClusterIdKey,
  RestoreDetail,
} from "../snapshot";
import { Phase } from "../velero";
import { SnapshotProvider, SnapshotStore } from "../snapshot_config";
import { logger } from "../../server/logger";
import { formatTTL, backup } from "../backup";
import { sleep } from "../../util/utilities";
import { nextScheduled } from "../schedule";

export function SnapshotMutations(stores: Stores) {
  // tslint:disable-next-line max-func-body-length cyclomatic-complexity
  return {
    async saveSnapshotConfig(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();

      const {
        appId,
        inputValue: retentionQuantity,
        inputTimeUnit: retentionUnit,
        userSelected: scheduleSelected,
        schedule: scheduleExpression,
        autoEnabled,
      } = args;

      const app = await stores.kotsAppStore.getApp(appId);

      const retention = formatTTL(retentionQuantity, retentionUnit);
      if (app.snapshotTTL !== retention) {
        await stores.kotsAppStore.updateAppSnapshotTTL(appId, retention);
      }

      if (!autoEnabled) {
        await stores.kotsAppStore.updateAppSnapshotSchedule(app.id, null);
        await stores.snapshotsStore.deletePendingScheduledSnapshots(app.id);
        return;
      }

      try {
        cronstrue.toString(scheduleExpression);
      } catch(e) {
        throw new ReplicatedError(`Invalid snapshot schedule: ${scheduleExpression}`);
      }
      if (scheduleExpression.split(" ").length > 5) {
        throw new ReplicatedError("Snapshot schedule expression does not support seconds or years");
      }

      if (scheduleExpression !== app.snapshotSchedule) {
        await stores.snapshotsStore.deletePendingScheduledSnapshots(app.id);
        await stores.kotsAppStore.updateAppSnapshotSchedule(app.id, scheduleExpression);
        const queued = nextScheduled(app.id, scheduleExpression);
        await stores.snapshotsStore.createScheduledSnapshot(queued);
      }
    },

    async snapshotProviderAWS(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();

      const { bucket, prefix, region, accessKeyID, accessKeySecret } = args;
      const config: SnapshotStore = {
        bucket,
        path: prefix,
        provider: SnapshotProvider.S3AWS,
        s3AWS: {
          region,
          accessKeyID,
          accessKeySecret,
        },
      };
      const slugs = await stores.kotsAppStore.listAppSlugs();
      const client = new VeleroClient("velero"); // TODO velero namespace

      try {
        await client.saveSnapshotStore(config, slugs);
      } catch(e) {
        logger.error(e);
        throw e;
      }
    },

    async snapshotProviderS3Compatible(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();

      const { bucket, prefix, region, endpoint, accessKeyID, accessKeySecret } = args;
      const config: SnapshotStore = {
        bucket,
        path: prefix,
        provider: SnapshotProvider.S3Compatible,
        s3Compatible: {
          region,
          endpoint,
          accessKeyID,
          accessKeySecret,
        },
      };
      const slugs = await stores.kotsAppStore.listAppSlugs();
      const client = new VeleroClient("velero"); // TODO velero namespace

      return client.saveSnapshotStore(config, slugs);
    },

    async snapshotProviderAzure(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();

      const { bucket, prefix, tenantID, resourceGroup,  storageAccount, subscriptionID, clientID, clientSecret, cloudName } = args;
      const config: SnapshotStore = {
        bucket,
        path: prefix,
        provider: SnapshotProvider.Azure,
        azure: {
          resourceGroup,
          storageAccount,
          subscriptionID,
          clientID,
          tenantID,
          clientSecret,
          cloudName,
        },
      };
      const slugs = await stores.kotsAppStore.listAppSlugs();
      const client = new VeleroClient("velero"); // TODO velero namespace

      return client.saveSnapshotStore(config, slugs);
    },

    async snapshotProviderGoogle(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();

      const { bucket, prefix, serviceAccount } = args;
      const config: SnapshotStore = {
        bucket,
        path: prefix,
        provider: SnapshotProvider.Google,
        google: {
          serviceAccount,
        },
      };
      const slugs = await stores.kotsAppStore.listAppSlugs();
      const client = new VeleroClient("velero"); // TODO velero namespace

      return client.saveSnapshotStore(config, slugs);
    },

    // tslint:disable-next-line cyclomatic-complexity
    async restoreSnapshot(root: any, args: any, context: Context): Promise<RestoreDetail> {
      context.requireSingleTenantSession();

      const restoreName = `${args.snapshotName}-${Date.now()}`;
      const velero = new VeleroClient("velero"); // TODO velero namespace

      // ensure the backup exists with required annotations
      const b = await velero.readBackup(args.snapshotName);
      if (!b.metadata.annotations) {
        throw new ReplicatedError(`Backup is missing appID, cluster ID and version annotations`);
      }
      const appId = b.metadata.annotations[kotsAppIdKey];
      if (!appId) {
        throw new ReplicatedError(`Backup is missing app ID annotation`);
      }
      const clusterId = b.metadata.annotations[kotsClusterIdKey];
      if (!clusterId) {
        throw new ReplicatedError(`Backup is missing cluster ID annotation`);
      }
      const sequenceString = b.metadata.annotations[kotsAppSequenceKey];
      if (!sequenceString) {
        throw new ReplicatedError(`Backup is missing version annotation`);
      }
      const sequence = parseInt(sequenceString, 10);
      if (_.isNaN(sequence)) {
        throw new ReplicatedError(`Failed to parse sequence from Backup: ${sequenceString}`);
      }
      logger.info(`Restore found Backup ${args.snapshotName} for app ${appId} sequence ${sequence} on cluster ${clusterId}`);

      // ensure the backup's kots app version exists in the db
      const currentVersion = await stores.kotsAppStore.getCurrentVersion(appId, clusterId);
      if (!currentVersion || currentVersion.sequence !== sequence) {
        const pastVersions = await stores.kotsAppStore.listPastVersions(appId, clusterId);
        const version = _.find(pastVersions, (v) => {
          return v.sequence === sequence;
        });
        if (!version) {
          throw new ReplicatedError(`Cannot restore version ${sequence} since it has never been installed in this cluster`);
        }
      }
      logger.info(`Restore confirmed version ${sequence} was previously installed`);

      // ensure no restore in progress
      const { restoreInProgressName } = await stores.kotsAppStore.getApp(appId);
      if (restoreInProgressName) {
        throw new ReplicatedError(`Restore ${restoreInProgressName} already in progress`);
      }

      // set restore in progress to switch deploy socket from deploy to undeploy mode
      // TODO most queries and mutations should be unavailable when this is set
      await stores.kotsAppStore.updateAppRestoreInProgressName(appId, restoreName);

      return { name: restoreName, phase: Phase.New, active: true, volumes: [], errors: [], warnings: [] };
    },

    async cancelRestore(root: any, args: any, context: Context): Promise<void> {
      await stores.kotsAppStore.updateAppRestoreReset(args.appId);
    },

    async deleteSnapshot(root: any, args: any, context: Context): Promise<void> {
      context.requireSingleTenantSession();
      const velero = new VeleroClient("velero"); // TODO namespace
      await velero.deleteSnapshot(args.snapshotName);
    },
  };
}
