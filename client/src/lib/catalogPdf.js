import { downloadFile } from "./downloadFile";

/**
 * Downloads the catalog PDF; rejects with a readable message on 429/500.
 * @param {"all"|"product"|"service"} [type="all"]
 */
export function downloadCatalogPdf(type = "all") {
  const allowed = type === "product" || type === "service" ? type : "all";
  return downloadFile(
    `/api/export/catalog.pdf?type=${encodeURIComponent(allowed)}`,
    `catalog-${allowed}.pdf`
  );
}
