/*
* dart-sass.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
*/
import { join } from "path/mod.ts";

import { binaryPath } from "./resources.ts";
import { execProcess } from "./process.ts";
import { sessionTempFile } from "./temp.ts";

export function dartSassInstallDir() {
  return binaryPath("dart-sass");
}

export async function dartSassVersion() {
  return await dartCommand(["--version"]);
}

export async function dartCompile(
  input: string,
  loadPaths?: string[],
  compressed?: boolean,
): Promise<string | undefined> {
  // Write the scss to a file
  // We were previously passing it via stdin, but that can be overflowed
  const inputFilePath = sessionTempFile({ suffix: "scss" });
  Deno.writeTextFileSync(inputFilePath, input);
  const args = [
    inputFilePath,
    "--style",
    compressed ? "compressed" : "expanded",
  ];

  if (loadPaths) {
    loadPaths.forEach((loadPath) => {
      args.push(`--load-path=${loadPath}`);
    });
  }

  return await dartCommand(args);
}

async function dartCommand(args: string[]) {
  const command = Deno.build.os === "windows" ? "sass.bat" : "sass";
  const sass = binaryPath(join("dart-sass", command));
  const cmd = [
    sass,
    ...args,
  ];

  // Run the sas compiler
  const result = await execProcess(
    {
      cmd,
      stdout: "piped",
      stderr: "piped",
    },
  );

  if (result.success) {
    return result.stdout;
  } else {
    throw new Error("Theme file compilation failed:\n\n" + result.stderr);
  }
}
