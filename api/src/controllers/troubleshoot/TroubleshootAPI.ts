import { Request, Response } from "express";
import { Controller, Post, Put, Get, Res, Req, BodyParams, PathParams, QueryParams } from "@tsed/common";
import { Params } from "../../server/params";
import { logger } from "../../server/logger";
import jsYaml from "js-yaml";
import { TroubleshootStore, injectKotsCollectors, setKotsCollectorsNamespaces } from "../../troubleshoot";
import { analyzeSupportBundle } from "../../troubleshoot/troubleshoot_ffi";
import fs from "fs";
import path from "path";
import { putObject, getS3 } from "../../util/s3";
import { Session } from "../../session";
import { Stores } from "../../schema/stores";

interface ErrorResponse {
  error: {};
}

interface BundleUploadedBody {
  size: number;
}

@Controller("/api/v1/troubleshoot")
export class TroubleshootAPI {
  @Get("/")
  async getGenericSpec(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<any | ErrorResponse> {
    let collector = TroubleshootStore.defaultSpec;

    let parsedSpec = jsYaml.load(collector);

    const params = await Params.getParams();

    // the injected collector has a different namespace in dev environment,
    // so the order of these calls matters.
    parsedSpec = await setKotsCollectorsNamespaces(parsedSpec);
    parsedSpec = injectKotsCollectors(params, parsedSpec, "");

    response.send(200, parsedSpec);
  }

  @Get("/:slug")
  async getSpec(
    @Req() request: Request,
    @Res() response: Response,
    @PathParams("slug") slug: string,
    @QueryParams("incluster") inCluster: string,
  ): Promise<any | ErrorResponse> {
    const collector = await request.app.locals.stores.troubleshootStore.tryGetCollectorForKotsSlug(slug);
    const isKotsSpec = true;

    let appOrWatchId;
    let licenseData = "";

    try {
      appOrWatchId = await request.app.locals.stores.kotsAppStore.getIdFromSlug(slug);
      const app = await request.app.locals.stores.kotsAppStore.getApp(appOrWatchId);
      licenseData = app.license;
    } catch {
      appOrWatchId = await request.app.locals.stores.watchStore.getIdFromSlug(slug);
    }

    const supportBundle = await request.app.locals.stores.troubleshootStore.getBlankSupportBundle(appOrWatchId);

    const params = await Params.getParams();

    let uploadUrl;
    if (request.header("Bundle-Upload-Host")) {
      uploadUrl = `${request.header("Bundle-Upload-Host")}/api/v1/troubleshoot/${appOrWatchId}/${supportBundle.id}`;
    } else if (inCluster === "true") {
      uploadUrl = `${params.shipApiEndpoint}/api/v1/troubleshoot/${appOrWatchId}/${supportBundle.id}`;
    } else {
      uploadUrl = `${params.apiAdvertiseEndpoint}/api/v1/troubleshoot/${appOrWatchId}/${supportBundle.id}`;
    }

    let parsedSpec = jsYaml.load(collector);
    if (isKotsSpec) {
      // the injected collector has a different namespace in dev environment,
      // so the order of these calls matters.
      parsedSpec = await setKotsCollectorsNamespaces(parsedSpec);
      parsedSpec = injectKotsCollectors(params, parsedSpec, licenseData);
    }
    parsedSpec.spec.afterCollection = [
      {
        "uploadResultsTo": {
          "method": "PUT",
          "uri": uploadUrl,
        },
      },
    ];

    response.send(200, parsedSpec);
  }

  @Put("/:appId/:supportBundleId")
  public async bundleUpload(
    @Res() response: Response,
    @Req() request: Request,
    @PathParams("appId") appId: string,
    @PathParams("supportBundleId") supportBundleId: string,
  ): Promise<any> {
    const bundleFile = request.app.locals.bundleFile;
    let analyzedBundle;

    try {
      const stores = request.app.locals.stores;

      const exists = await stores.troubleshootStore.supportBundleExists(supportBundleId);
      if (exists) {
        response.send(403);
        return;
      }

      // upload it to s3
      const params = await Params.getParams();
      const buffer = fs.readFileSync(bundleFile);
      await putObject(params, path.join(params.shipOutputBucket.trim(), "supportbundles", supportBundleId, "supportbundle.tar.gz"), buffer, params.shipOutputBucket);
      const fileInfo = await stores.troubleshootStore.getSupportBundleFileInfo(supportBundleId);

      logger.debug({ msg: `creating support bundle record with id ${supportBundleId} via upload callback` });

      await stores.troubleshootStore.createSupportBundle(appId, fileInfo.ContentLength, supportBundleId);

      const analyzers = await stores.troubleshootStore.tryGetAnalyzersForKotsApp(appId);
      await performAnalysis(supportBundleId, analyzers, stores);

      analyzedBundle = await stores.troubleshootStore.getSupportBundle(supportBundleId);
    } finally {
      fs.unlinkSync(bundleFile);
      response.send(200, analyzedBundle);
    }
  }

  @Post("/analyzebundle/:supportBundleId")
  public async analyzeBundle(
    @Res() response: Response,
    @Req() request: Request,
    @PathParams("supportBundleId") supportBundleId: string,
  ): Promise<any> {
    const stores = request.app.locals.stores;

    // Check if bundle exists
    const exists = await stores.troubleshootStore.supportBundleExists(supportBundleId);
    if (!exists) {
      response.send(404, "Bundle does not exist");
      return;
    }

    const b = await stores.troubleshootStore.getSupportBundle(supportBundleId);
    const analyzers = await stores.troubleshootStore.tryGetAnalyzersForKotsApp(b.watchId);
    await performAnalysis(supportBundleId, analyzers, stores);
    const analyzedBundle = await stores.troubleshootStore.getSupportBundle(supportBundleId);

    response.send(200, analyzedBundle);
  }

  @Post("/:watchId/:supportBundleId")
  public async bundleUploaded(
    @Res() response: Response,
    @Req() request: Request,
    @BodyParams("") body: BundleUploadedBody,
    @PathParams("watchId") watchId: string,
    @PathParams("supportBundleId") supportBundleId: string,
  ): Promise<any> {
    const stores = request.app.locals.stores;

    // Don't create support bundle if there is one with the same ID
    const exists = await stores.troubleshootStore.supportBundleExists(supportBundleId);
    if (exists) {
      response.send(403);
      return;
    }

    const fileInfo = await stores.troubleshootStore.getSupportBundleFileInfo(supportBundleId);

    logger.debug({ msg: `creating support bundle record with id ${supportBundleId} via upload callback` });

    await stores.troubleshootStore.createSupportBundle(watchId, fileInfo.ContentLength, supportBundleId);
    await performAnalysis(supportBundleId, "", stores);

    response.send(204, "");
  }

  @Get(`/supportbundle/:bundleId/download`)
  async downloadSupportBundle(
    @Req() request: Request,
    @Res() response: Response,
    @PathParams("bundleId") bundleId: string,
    @QueryParams("token") token: string,
  ): Promise<any | ErrorResponse> {
    const session: Session = await request.app.locals.stores.sessionStore.decode(token);
    if (!session || !session.userId) {
      response.status(401);
      return {};
    }

    const supportBundle = await request.app.locals.stores.troubleshootStore.getSupportBundle(bundleId);

    if (!supportBundle) {
      response.status(404);
      return {};
    }

    response.setHeader("Content-Disposition", `attachment; filename=supportbundle.tar.gz`);
    response.setHeader("Content-Type", "application/tar+gzip");
    await s3getBundle(bundleId, response);
  }
}

async function performAnalysis(supportBundleId: string, analyzers: string, stores: Stores) {
  await stores.troubleshootStore.markSupportBundleUploaded(supportBundleId);
  const supportBundle = await stores.troubleshootStore.getSupportBundle(supportBundleId);
  const dirTree = await supportBundle.generateFileTreeIndex();
  await stores.troubleshootStore.assignTreeIndex(supportBundleId, JSON.stringify(dirTree));

  await analyzeSupportBundle(supportBundleId, analyzers, stores);
}

async function s3getBundle(bundleId, response) {
  const replicatedParams = await Params.getParams();
  const params = {
    Bucket: replicatedParams.shipOutputBucket,
    Key: `${replicatedParams.s3BucketEndpoint !== "" ? `${replicatedParams.shipOutputBucket}/` : ""}supportbundles/${bundleId}/supportbundle.tar.gz`,
  };

  return new Promise((resolve, reject) => {
    response.on("error", err => {
      console.log(err);
      resolve(false);
    });

    response.on("finish", async () => {
      try {
        resolve(true);
      } catch (err) {
        console.log(err);
        resolve(false);
      }
    });

    getS3(replicatedParams).getObject(params).createReadStream().pipe(response);
  });
}
