import { Server } from "./server";
import {RequestLogger, OverrideMiddleware, LogIncomingRequestMiddleware, Req, IDILogger} from "@tsed/common";
import uuid from "uuid";

import Express from "express";
import { logger, TSEDVerboseLogging } from "./logger";

const suppressLog = function(...args: any[]): void | any {};
const suppressLogger: IDILogger = {
  info: suppressLog,
  warn: suppressLog,
  debug: suppressLog,
  error: suppressLog,
  trace: suppressLog,
};

@OverrideMiddleware(LogIncomingRequestMiddleware)
export class CustomLogIncomingRequestMiddleware extends LogIncomingRequestMiddleware {
  use(@Req() request: Express.Request) {
    request.id = uuid.v4();

    // Suppress logging from /healthz and the noisy /api/v1/deploy/desired endpoint
    if (request.path === "/healthz" || request.path ==="/api/v1/deploy/desired") {
      this.configureRequest(request, true);

      return;
    }

    super.use(request);
  }

  // mostly copy pasted, added suppress flag for quieter healthz logging
  protected configureRequest(request: Express.Request, suppress?: boolean) {
    const {ignoreUrlPatterns = []} = this.injector.settings.logger;

    const minimalInfo = (req: Express.Request) => this.minimalRequestPicker(req);
    const requestObj = (req: Express.Request) => this.requestToObject(req);

    let logger = this.injector.logger;
    if (suppress) {
      logger = suppressLogger;
    }

    request.log = new RequestLogger(logger, {
      id: request.ctx.id,
      startDate: request.ctx.dateStart,
      url: request.originalUrl || request.url,
      ignoreUrlPatterns,
      minimalRequestPicker: (obj: any) => ({...minimalInfo, ...obj}),
      completeRequestPicker: (obj: any) => ({...requestObj, ...obj})
    });
  }

  // pretty much copy-pasted, but hooked into TSEDVerboseLogging from above to control multiline logging
  protected stringify(request: Express.Request, propertySelector: (e: Express.Request) => {}): (scope: {}) => string {
    return inscope => {
      let scope = inscope;
      if (!scope) {
        scope = {};
      }

      if (typeof scope === "string") {
        scope = { message: scope };
      }

      scope = { ...scope, ...propertySelector(request) };
      try {
        if (TSEDVerboseLogging) {
          return JSON.stringify(scope, null, 2);
        }

        return JSON.stringify(scope);
      } catch (err) {
        logger.error({ msg: "error logging message", error: err });
      }

      return "";
    };
  }

  protected requestToObject(request: Express.Request) {
    if (request.originalUrl === "/healthz" || request.url === "/healthz") {
      return {
        url: "/healthz",
      };
    }

    if (TSEDVerboseLogging) {
      return {
        reqId: request.id,
        method: request.method,
        url: request.originalUrl || request.url,
        headers: request.headers,
        body: request.body,
        query: request.query,
        params: request.params,
      };
    } else {
      return {
        reqId: request.id,
        method: request.method,
        url: request.originalUrl || request.url,
      };
    }
  }
}

// tslint:disable no-console
function main() {
  new Server()
    .start()
    .then(() => {
      process.on("SIGINT", () => {
        console.log("received interrupt...");
        setTimeout(() => {
          process.exit(137);
        }, 100);
      });
      process.on('unhandledRejection', (reason, p) => {
        console.error('Unhandled Rejection at Promise', p, reason);
      });
      process.on('uncaughtException', err => {
        console.error('Uncaught Exception thrown', err);
      });
    })
    .catch(err => {
      console.log("received error...", err);
      setTimeout(() => {
        process.exit(137);
      }, 100);
    });
}

main();
