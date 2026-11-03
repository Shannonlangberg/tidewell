"use client";

import { Button } from "../../Button";

/** Opens the browser's print dialog, where "Save as PDF" gives the PDF. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" icon="download" onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  );
}
