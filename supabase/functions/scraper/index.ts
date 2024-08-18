import { serve } from "https://deno.land/x/sift@0.6.0/mod.ts";
import axios from "https://cdn.skypack.dev/axios";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

// Function to fetch static content
async function fetchStaticContent(url: string): Promise<string> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Referer": "https://www.google.com/",
  };

  const response = await axios.get(url, { headers });
  return response.data;
}

// Function to extract price and currency using regex
function extractPriceFromDocument(doc: Document): { price: number | null, currency: string | null } {
  const priceSelectors = [
    '#priceblock_ourprice',
    '.price',
    '.item_price[data-hook="product_price"]',
    'meta[itemprop="price"]',
    '.a-offscreen',
  ];

  for (const selector of priceSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      const priceText = element.textContent?.trim() || "";
      const match = priceText.match(/([₹$€£¥])\s?(\d+[\.,]?\d*)/);
      if (match) {
        const currency = match[1];
        const price = parseFloat(match[2].replace(',', ''));
        return { price, currency };
      }
    }
  }

  const priceRegex = /([₹$€£¥])\s?(\d+[\.,]?\d*)/;
  const match = priceRegex.exec(doc.body?.textContent || "");
  if (match) {
    const currency = match[1];
    const price = parseFloat(match[2].replace(',', ''));
    return { price, currency };
  }

  return { price: null, currency: null };
}

// Function to extract image URL
function extractImageFromDocument(doc: Document): string | null {
  const imageSelectors = [
    '#landingImage',
    '.a-dynamic-image',
    '.product-image',
    '.primary-image',
  ];

  for (const selector of imageSelectors) {
    const element = doc.querySelector(selector);
    if (element) {
      return element.getAttribute('src') || null;
    }
  }

  return null;
}

// Function to parse HTML content with deno-dom
function parseHtmlWithDenoDom(htmlContent: string): Record<string, any> {
  const doc = new DOMParser().parseFromString(htmlContent, "text/html");
  if (!doc) {
    throw new Error("Failed to parse HTML document.");
  }

  const productDetails: Record<string, any> = {};

  productDetails.name = doc.querySelector('h1')?.textContent?.trim() || null;
  const { price, currency } = extractPriceFromDocument(doc);
  productDetails.price = price;
  productDetails.currency = currency;
  productDetails.description = doc.querySelector('.product-description')?.textContent?.trim() || null;
  productDetails.image_url = extractImageFromDocument(doc);

  return productDetails;
}

// Function to handle dynamic content with Puppeteer
async function scrapeDynamicContent(url: string): Promise<Record<string, any>> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForTimeout(Math.random() * 2000 + 2000); // Random delay to mimic human behavior

  const content = await page.content();
  const productDetails = parseHtmlWithDenoDom(content);

  await browser.close();
  return productDetails;
}

// Main function handler
async function scrapeProductData(url: string): Promise<Record<string, any>> {
  try {
    const htmlContent = await fetchStaticContent(url);
    let productDetails = parseHtmlWithDenoDom(htmlContent);

    if (!productDetails.name || !productDetails.price) {
      productDetails = await scrapeDynamicContent(url);
    }

    return productDetails;

  } catch (error) {
    return { error: error.message };
  }
}

// Add CORS headers to the response
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

// Serve the function at the /scraper path
serve({
  "/scraper": async (req) => {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(req.url).searchParams.get('url');
    if (!url) {
      return addCorsHeaders(new Response(JSON.stringify({ error: 'Missing URL parameter' }), { status: 400 }));
    }

    const productData = await scrapeProductData(url);
    return addCorsHeaders(new Response(JSON.stringify(productData), {
      headers: { 'Content-Type': 'application/json' },
    }));
  }
});
