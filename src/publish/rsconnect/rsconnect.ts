/*
* rsconnect.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/

import { info, warning } from "log/mod.ts";
import * as colors from "fmt/colors.ts";

import { Input } from "cliffy/prompt/input.ts";
import { Secret } from "cliffy/prompt/secret.ts";

import {
  AccountToken,
  AccountTokenType,
  PublishFiles,
  PublishProvider,
} from "../provider.ts";
import { PublishRecord } from "../types.ts";
import { RSConnectClient } from "./api/index.ts";
import { ApiError, Content, Task } from "./api/types.ts";
import {
  readAccessTokens,
  writeAccessToken,
  writeAccessTokens,
} from "../common/account.ts";
import { ensureProtocolAndTrailingSlash } from "../../core/url.ts";

import { pandocAutoIdentifier } from "../../core/pandoc/pandoc-id.ts";
import { createTempContext } from "../../core/temp.ts";
import { createBundle } from "./bundle.ts";
import { completeMessage, withSpinner } from "../../core/console.ts";
import { randomHex } from "../../core/random.ts";

export const kRSConnect = "rsconnect";
const kRSConnectDescription = "RS Connect";

export const kRSConnectServerVar = "CONNECT_SERVER";
export const kRSConnectAuthTokenVar = "CONNECT_API_KEY";

// TODO: add --config argument to quarto publish
// TODO: default netlify app id
// TODO: make quartopub conditional on env var
// TODO: README docs

export const rsconnectProvider: PublishProvider = {
  name: kRSConnect,
  description: kRSConnectDescription,
  accountTokens,
  authorizeToken,
  removeToken,
  resolveTarget,
  publish,
  isUnauthorized,
};

type Account = {
  username: string;
  server: string;
  key: string;
};

function accountTokens() {
  const accounts: AccountToken[] = [];

  // check for environment variable
  const server = Deno.env.get(kRSConnectServerVar);
  const apiKey = Deno.env.get(kRSConnectAuthTokenVar);
  if (server && apiKey) {
    accounts.push({
      type: AccountTokenType.Environment,
      name: kRSConnectAuthTokenVar,
      server,
      token: apiKey,
    });
  }

  // check for recorded tokens
  const tokens = readAccessTokens<Account>(kRSConnect);
  if (tokens) {
    accounts.push(...tokens.map((token) => ({
      type: AccountTokenType.Authorized,
      name: token.username,
      server: token.server,
      token: token.key,
    })));
  }

  return Promise.resolve(accounts);
}

function removeToken(token: AccountToken) {
  writeAccessTokens(
    rsconnectProvider.name,
    readAccessTokens<Account>(rsconnectProvider.name)?.filter(
      (accessToken) => {
        return accessToken.username !== token.name;
      },
    ) || [],
  );
}

async function authorizeToken(
  target?: PublishRecord,
): Promise<AccountToken | undefined> {
  // ask for server (then validate that its actually a connect server
  // by sending a request without an auth token)
  let server = target?.url ? new URL(target.url).origin : undefined;
  while (server === undefined) {
    // prompt for server
    server = await Input.prompt({
      message: "Server URL:",
      hint: "e.g. https://connect.example.com/",
      validate: (value) => {
        // 'Enter' with no value ends publish
        if (value.length === 0) {
          throw new Error();
        }
        try {
          const url = new URL(ensureProtocolAndTrailingSlash(value));
          if (!["http:", "https:"].includes(url.protocol)) {
            return `${value} is not an HTTP URL`;
          } else {
            return true;
          }
        } catch {
          return `${value} is not a valid URL`;
        }
      },
      transform: ensureProtocolAndTrailingSlash,
    });

    // validate that its a connect server
    const client = new RSConnectClient(server);
    try {
      await client.getUser();
    } catch (err) {
      // connect server will give 401 for unauthorized, break out
      // of the loop in that case
      if (isUnauthorized(err)) {
        break;
      } else {
        info(
          colors.red(
            "   Unable to connect to server (is this a valid RStudio Connect Server?)",
          ),
        );
        server = undefined;
      }
    }
  }

  // get apiKey and username
  while (true) {
    const apiKey = await Secret.prompt({
      message: "API Key:",
      hint: "Learn more at https://docs.rstudio.com/connect/user/api-keys/",
    });
    // 'Enter' with no value ends publish
    if (apiKey.length === 0) {
      throw new Error();
    }
    // get the user info
    try {
      const client = new RSConnectClient(server, apiKey);
      const user = await client.getUser();
      if (user.user_role !== "viewer") {
        // record account
        const account: Account = {
          username: user.username,
          server,
          key: apiKey,
        };
        writeAccessToken(
          kRSConnect,
          account,
          (a, b) => a.server === b.server,
        );
        // return access token
        return {
          type: AccountTokenType.Authorized,
          name: user.username,
          server,
          token: apiKey,
        };
      } else {
        promptError(
          "API key is for an RStudio Connect viewer rather than a publisher.",
        );
      }
    } catch (err) {
      if (isUnauthorized(err)) {
        promptError(
          "API key is not authorized for this RStudio Connect server.",
        );
      } else {
        throw err;
      }
    }
  }
}

async function resolveTarget(
  account: AccountToken,
  target: PublishRecord,
) {
  try {
    const client = new RSConnectClient(account.server!, account.token);
    const content = await client.getContent(target.id);
    return contentAsTarget(content);
  } catch (err) {
    if (isNotFound(err)) {
      return target;
    } else if (!isUnauthorized(err)) {
      throw err;
    }
  }

  return target;
}

async function publish(
  account: AccountToken,
  type: "document" | "site",
  title: string,
  render: (siteUrl?: string) => Promise<PublishFiles>,
  target?: PublishRecord,
): Promise<[PublishRecord, URL]> {
  // create client
  const client = new RSConnectClient(account.server!, account.token);

  let content: Content | undefined;
  await withSpinner({
    message: `Preparing to publish ${type}`,
  }, async () => {
    if (!target) {
      content = await createContent(client, title);
      if (content) {
        target = contentAsTarget(content);
      } else {
        throw new Error();
      }
    } else {
      content = await client.getContent(target!.id);
    }
  });
  info("");

  // render
  const publishFiles = await render();

  // publish
  const tempContext = createTempContext();
  try {
    // create and upload bundle
    let task: Task | undefined;
    await withSpinner({
      message: () => `Uploading files`,
    }, async () => {
      const bundleTargz = await createBundle(type, publishFiles, tempContext);
      const bundleBytes = Deno.readFileSync(bundleTargz);
      const bundleBlob = new Blob([bundleBytes.buffer]);
      const bundle = await client.uploadBundle(target!.id, bundleBlob);
      task = await client.deployBundle(bundle);
    });

    await withSpinner({
      message: `Publishing ${type}`,
    }, async () => {
      while (true) {
        const status = await client.getTaskStatus(task!);
        if (status.finished) {
          if (status.code === 0) {
            break;
          } else {
            throw new Error(
              `Error attempting to publish content: ${status.code} - ${status.error}`,
            );
          }
        }
      }
    });
    completeMessage(`Published: ${target!.url}\n`);
    return Promise.resolve([target!, new URL(content!.dashboard_url)]);
  } finally {
    tempContext.cleanup();
  }
}

function isUnauthorized(err: Error) {
  return err instanceof ApiError && err.status === 401;
}

function isConflict(err: Error) {
  return err instanceof ApiError && err.status === 409;
}

function isNotFound(err: Error) {
  return err instanceof ApiError && err.status === 404;
}

function contentAsTarget(content: Content): PublishRecord {
  return { id: content.guid, url: content.content_url, code: false };
}

async function createContent(
  client: RSConnectClient,
  title: string,
): Promise<Content | undefined> {
  const baseName = pandocAutoIdentifier(title, false);
  while (true) {
    const name = baseName + "-" + randomHex(4);
    try {
      return await client.createContent(name, title);
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
    }
  }
}

function promptError(msg: string) {
  info(colors.red(`  ${msg}`));
}
