import { isAbsolute, join } from "path/mod.ts";

import { RenderResult } from "../../command/render/types.ts";
import { md5Hash } from "../../core/hash.ts";
import { isJupyterNotebook } from "../../core/jupyter/jupyter.ts";
import { isHtmlContent } from "../../core/mime.ts";
import { PromiseQueue } from "../../core/promise.ts";
import { extensionFilesFromDirs } from "../../extension/extension.ts";
import { projectFormatOutputDir, projectOutputDir } from "../project-shared.ts";
import { kProjectType, ProjectContext } from "../types.ts";
import { projectType } from "../types/project-types.ts";

export class ServeRenderManager {
  public renderQueue() {
    return this.renderQueue_;
  }

  public fileRequiresReRender(
    file: string,
    inputFile: string,
    extensionDirs: string[],
    resourceFiles: string[],
    project: ProjectContext,
  ) {
    const lastRenderHash = this.fileRenders_.get(file);
    if (lastRenderHash) {
      return lastRenderHash !==
        this.fileRenderHash(
          file,
          inputFile,
          extensionDirs,
          resourceFiles,
          project,
        );
    } else {
      return true;
    }
  }

  public onRenderResult(
    result: RenderResult,
    extensionDirs: string[],
    resourceFiles: string[],
    project: ProjectContext,
  ) {
    // Use the first file to determine the format
    let outputDir: string;
    if (result.files.length > 0) {
      const format = result.files[0].format;
      outputDir = projectFormatOutputDir(
        format,
        project,
        projectType(project.config?.project?.[kProjectType]),
      );
    } else {
      outputDir = projectOutputDir(project);
    }

    result.files.forEach((resultFile) => {
      const file = isAbsolute(resultFile.file)
        ? resultFile.file
        : join(outputDir, resultFile.file);
      const inputFile = isAbsolute(resultFile.input)
        ? resultFile.input
        : join(project.dir, resultFile.input);
      this.fileRenders_.set(
        file,
        this.fileRenderHash(
          file,
          inputFile,
          extensionDirs,
          resourceFiles,
          project,
        ),
      );
    });
  }

  private fileRenderHash(
    file: string,
    inputFile: string,
    extensionDirs: string[],
    resourceFiles: string[],
    project: ProjectContext,
  ) {
    const resourceHash = [
      file,
      inputFile,
      ...resourceFiles,
      ...extensionFilesFromDirs(extensionDirs),
      ...(project.files.config || []),
      ...(project.files.configResources || []),
      ...(project.files.resources || []),
    ].reduce((hash, file) => {
      try {
        return hash + Deno.statSync(file).mtime?.toUTCString();
      } catch {
        return hash;
      }
    }, "");
    // very large jupyter notebooks can take a long time to hash
    // (~ 2 seconds for every 10mb) so we use the slightly less
    // robust file modification time in that case. non-html
    // content also shouldn't be read with readTextFileSync
    if (isJupyterNotebook(inputFile) || !isHtmlContent(file)) {
      return String(Deno.statSync(file).mtime) +
        String(Deno.statSync(inputFile).mtime) +
        resourceHash;
    } else {
      return md5Hash(Deno.readTextFileSync(file)) +
        md5Hash(Deno.readTextFileSync(inputFile)) +
        resourceHash;
    }
  }

  private fileRenders_ = new Map<string, string>();
  private renderQueue_ = new PromiseQueue<RenderResult>();
}
