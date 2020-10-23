/*
* pandoc.ts
*
* Copyright (C) 2020 by RStudio, PBC
*
* Unless you have received this program directly from RStudio pursuant
* to the terms of a commercial license agreement with RStudio, then
* this program is licensed to you under the terms of version 3 of the
* GNU General Public License. This program is distributed WITHOUT
* ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
* MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
* GPL (http://www.gnu.org/licenses/gpl-3.0.txt) for more details.
*
*/

import { basename, dirname } from "path/mod.ts";
import { stringify } from "encoding/yaml.ts";

import { execProcess, ProcessResult } from "../../core/process.ts";
import { message } from "../../core/console.ts";

import { Format } from "../../config/format.ts";
import { pdfEngine } from "../../config/pdf.ts";
import { Metadata } from "../../config/metadata.ts";

import { RenderFlags } from "./flags.ts";
import { kMetadataFormat } from "../../config/constants.ts";

// options required to run pandoc
export interface PandocOptions {
  // input file
  input: string;
  // full merged config
  metadata: Metadata;
  // target format
  format: Format;
  // command line args for pandoc
  args: string[];
  // command line flags (e.g. could be used
  // to specify e.g. quiet or pdf engine)
  flags?: RenderFlags;
}

export async function runPandoc(
  options: PandocOptions,
): Promise<ProcessResult> {
  // read the input file then append the metadata to the file (this is to that)
  // our fully resolved metadata, which incorporates project and format-specific
  // values, overrides the metadata contained within the file). we'll feed the
  // input to pandoc on stdin
  let input = await Deno.readTextFile(options.input);
  if (Object.keys(options.metadata).length > 0) {
    input += `\n---\n${stringify(options.metadata)}\n---\n`;
  }

  // build the pandoc command (we'll feed it the input on stdin)
  const cmd = ["pandoc"];

  // write a temporary defaults file
  let yaml = "";
  if (options.format.pandoc) {
    yaml = "---\n" + stringify(options.format.pandoc);
    const yamlFile = await Deno.makeTempFile(
      { prefix: "quarto-defaults", suffix: ".yml" },
    );
    await Deno.writeTextFile(yamlFile, yaml);
    cmd.push("--defaults", yamlFile);
  }

  // build command line args
  const args = [...options.args];

  // add citeproc if necessary
  const citeproc = citeMethod(options) === "citeproc";
  if (citeproc) {
    args.unshift("--citeproc");
  }

  // propagate quiet
  if (options.flags?.quiet) {
    args.push("--quiet");
  }

  // add user command line args
  cmd.push(...args);

  // print defaults file and command line args
  if (!options.flags?.quiet) {
    if (options.args.length > 0) {
      message(yaml + "args: " + args.join(" "));
    } else {
      message(yaml);
    }
    message("---\n");
  }

  // run pandoc
  return await execProcess(
    {
      cmd,
      cwd: dirname(options.input),
    },
    input,
  );
}

export type CiteMethod = "citeproc" | "natbib" | "biblatex";

export function citeMethod(
  options: PandocOptions,
): CiteMethod | null {
  // no handler if no references
  if (!options.metadata.bibliography && !options.metadata.references) {
    return null;
  }

  // collect config
  const pdf = pdfEngine(options.format.pandoc, options.flags);

  // if it's pdf-based output check for natbib or biblatex
  if (pdf?.bibEngine) {
    return pdf.bibEngine;
  }

  // otherwise it's citeproc unless expressly disabled
  if (options.metadata.citeproc !== false) {
    return "citeproc";
  } else {
    return null;
  }
}
