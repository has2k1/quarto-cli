/*
 * format-dashboard-navbutton.ts
 *
 * Copyright (C) 2020-2022 Posit Software, PBC
 */

import { Document } from "../../core/deno-dom.ts";
import {
  DashboardMeta,
  kNavButtons,
  makeEl,
} from "./format-dashboard-shared.ts";

export function processNavButtons(doc: Document, dashboardMeta: DashboardMeta) {
  const buttons = dashboardMeta[kNavButtons];

  // Don't bother if there are no butons
  if (buttons === undefined || buttons.length === 0) {
    return;
  }

  // Find the navbar, which will be using to make navigation
  const navbarEl = doc.querySelector(".navbar");
  if (!navbarEl) {
    throw new Error(
      "Expected a navbar in the dashboard output since pages are specified.",
    );
  }

  // The target container
  const navbarContainerEl = navbarEl.querySelector(".navbar-container");
  if (!navbarContainerEl) {
    throw new Error(
      "Expected the navbar to have a container marked with `.navbar-container`.",
    );
  }

  const containerEl = makeEl(
    "DIV",
    { classes: ["quarto-dashboard-links"] },
    doc,
  );
  buttons.forEach((btn) => {
    const linkEl = makeEl("A", {
      classes: ["quarto-dashboard-link"],
      attributes: { href: btn.href },
    }, doc);

    if (btn.icon) {
      const iconEl = makeEl("I", { classes: ["bi", `bi-${btn.icon}`] }, doc);
      linkEl.appendChild(iconEl);
    }

    if (btn.text) {
      const textEl = makeEl(
        "SPAN",
        { classes: ["quarto-dashboard-link-text"] },
        doc,
      );
      textEl.innerText = btn.text;
      linkEl.appendChild(textEl);
    }
    containerEl.appendChild(linkEl);
  });
  navbarContainerEl.appendChild(containerEl);
}
