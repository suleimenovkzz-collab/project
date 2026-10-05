import { setRatesToKzt } from "./money";

let maxQtyPerItem = 10;
let loading = null;

export function getMaxQtyPerItem() {
  return maxQtyPerItem;
}

export function loadShopConfig() {
  if (!loading) {
    loading = fetch("/api/shop-config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (config?.ratesToKzt) setRatesToKzt(config.ratesToKzt);
        const max = Number(config?.maxQtyPerItem);
        if (Number.isInteger(max) && max > 0) maxQtyPerItem = max;
        return config;
      })
      .catch(() => {
        loading = null;
        return null;
      });
  }
  return loading;
}
