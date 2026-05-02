import { logger } from "../lib/logger.js";

const REPLIERS_BASE = "https://api.repliers.io";

export type PropertyDetails = {
  mlsNumber: string;
  address: string;
  listPrice: string;
  listingBrokerageName: string;
  coopCommission: string;
};

function getApiKey(): string | null {
  return process.env["REPLIERS_API_KEY"] ?? null;
}

function formatPrice(price: number): string {
  return `$${price.toLocaleString("en-CA")}`;
}

function buildAddress(addr: Record<string, string | undefined>): string {
  const parts = [
    addr["streetNumber"],
    addr["streetName"],
    addr["streetSuffix"],
  ]
    .filter(Boolean)
    .join(" ");
  const city = addr["city"] ?? "";
  const state = addr["state"] ?? addr["province"] ?? "";
  const zip = addr["zip"] ?? addr["postalCode"] ?? "";
  return [parts, city, state, zip].filter(Boolean).join(", ");
}

export async function fetchPropertyByMls(
  mlsNumber: string
): Promise<PropertyDetails | null> {
  const key = getApiKey();
  if (!key) {
    logger.warn("REPLIERS_API_KEY not set — skipping MLS lookup");
    return null;
  }

  try {
    const url = `${REPLIERS_BASE}/listings?mlsNumber=${encodeURIComponent(mlsNumber)}&resultsPerPage=1`;
    const res = await fetch(url, {
      headers: {
        "REPLIERS-API-KEY": key,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const body = await res.text();
      logger.warn({ status: res.status, body }, "Repliers API non-OK response");
      return null;
    }

    const data = (await res.json()) as {
      listings?: {
        mlsNumber?: string;
        listPrice?: number;
        address?: Record<string, string | undefined>;
        office?: { brokerageName?: string };
        details?: { coopCommission?: string };
        commission?: { cooperatingCommission?: string };
      }[];
      count?: number;
    };

    const listing = data.listings?.[0];
    if (!listing) return null;

    const address = listing.address ? buildAddress(listing.address) : "";
    if (!address) return null;

    const listPrice = listing.listPrice ? formatPrice(listing.listPrice) : "";
    const listingBrokerageName = listing.office?.brokerageName ?? "";
    const coopCommission =
      listing.details?.coopCommission ??
      listing.commission?.cooperatingCommission ??
      "";

    return {
      mlsNumber: listing.mlsNumber ?? mlsNumber,
      address,
      listPrice,
      listingBrokerageName,
      coopCommission,
    };
  } catch (err) {
    logger.error({ err }, "Repliers fetch error");
    return null;
  }
}
