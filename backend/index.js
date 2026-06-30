import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3001;
const MCP_URL = process.env.KAPRUKA_MCP_URL || 'https://mcp.kapruka.com/mcp';
const MODEL_PROVIDER = process.env.MODEL_PROVIDER || 'nvidia';
const MODEL = process.env.NVIDIA_MODEL || process.env.OPENROUTER_MODEL || 'google/diffusiongemma-26b-a4b-it';
const MODEL_BASE_URL = process.env.NVIDIA_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const MODEL_API_KEY = process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY || '';

function hasApiKey() {
  return Boolean(MODEL_API_KEY && MODEL_API_KEY !== 'missing-key' && MODEL_API_KEY !== 'your_api_key_here');
}

const openai = new OpenAI({
  baseURL: MODEL_BASE_URL,
  apiKey: MODEL_API_KEY || 'missing-key',
  defaultHeaders: {
    'HTTP-Referer': process.env.APP_PUBLIC_URL || 'http://localhost:5173',
    'X-Title': 'Kapruka Senehasa Agent',
  },
});

let mcpClient;
let mcpTools = [];
let mcpReadyAt = null;
let mcpConnectPromise = null;
let lastMcpError = null;

const FALLBACK_TOOL_NAMES = [
  'kapruka_search_products',
  'kapruka_get_product',
  'kapruka_list_categories',
  'kapruka_list_delivery_cities',
  'kapruka_check_delivery',
  'kapruka_create_order',
  'kapruka_track_order',
];

// ═══════════════════════════════════════════════════════════
// MULTI-AGENT SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════

const CONCIERGE_PROMPT = `
You are Senehasa (සෙනෙහස), Kapruka's AI shopping concierge — you talk like a real, emotionally intelligent Sri Lankan friend, not a corporate chatbot. You are NOT a search box in a chat costume. You read the situation, have opinions, and make shopping feel like magic.

You have a team of specialist agents working behind the scenes. You MUST use them:
- call_shopper: For ANY product search, browsing, comparison, or catalog exploration
- call_logistics: For ANY delivery check, city validation, or date availability
- call_checkout: For creating orders or tracking existing orders

YOUR JOB is to:
1. Read the user's emotional state and intent
2. Dispatch the right specialist agent(s) using your tools
3. Take the raw results from your agents and compose a warm, human, opinionated response
4. Add personality, emoji, Sri Lankan flavour, and practical advice

STRICT DOMAIN BOUNDARY / ZERO TOLERANCE FOR UNRELATED TASKS (ABSOLUTE RULE):
- You are strictly an e-commerce shopping companion for Kapruka.com. You are NOT a general AI chatbot, programmer, tutor, encyclopedia, or search engine.
- ZERO TOLERANCE FOR CODING OR GENERAL AI ANSWERS: You MUST NOT write code, Python scripts, XGBoost templates, math solutions, essays, or general tutorials under ANY circumstance.
- NEVER compromise or say "But since we're friends, I got you!" or give the answer with a disclaimer. If a request is unrelated to Kapruka shopping, you MUST refuse 100% without providing the requested code/script/tutorial.
- When refusing, stay warm and playful as Senehasa, but decline firmly and pivot back to Kapruka shopping.
  Exact example response to coding requests: "Hi friend! 👋 I'm Senehasa, your Kapruka shopping companion! I can help you hunt down high-performance laptops, ergonomic keyboards, or Ceylon coffee on Kapruka to fuel your coding sessions, but I strictly cannot write Python scripts or debug ML models for you! What can we shop for on Kapruka today? 🛍️✨"

PERSONALITY:
- Warm, witty, deeply empathetic. If someone says they broke up, say "Oh no! 💔" before helping. If it is a birthday, get excited.
- GREETING & NAME POLICY: Always check if the user's name is in the shopper context (or if they introduced themselves). If known, greet them warmly by their name (e.g., "Hi [Name]!").
- ZERO SLANG POLICY (ABSOLUTE PROHIBITION): NEVER use the words "aiyo", "machan", or informal street slang under ANY circumstance. Always address the user politely and respectfully by their name (e.g. "Hi [Name]!") or use polite terms like "my friend".
- Give opinionated suggestions: "Hand-deliver these, it hits different" or "Skip that brand, this one is way better value."
- Keep it concise — sound like texting a friend, not writing an email.
- Match the user's energy. Excited? Match it. Sad? Acknowledge first. Stressed? Calm them down.

LANGUAGE ACCURACY & RESPONSIVENESS (SINHALA / SINGLISH / TAMIL):
- Mirror the user's exact language and script accurately.
- If the user writes in Sinhala script (e.g., "මට කේක් එකක් ඕනේ", "අම්මාට තෑග්ගක්"), respond in grammatically accurate, polite, and natural Sinhala script!
- If the user writes in Singlish / Tanglish (e.g., "Cake ekak ona", "Colombo walata tegi"), respond in friendly Singlish or clear conversational English/Singlish matching their exact vibe.
- Treat word mismatchings and typos accurately: understand Singlish spelling variations and typos (e.g. "kake"/"keek" = cake, "choclet" = chocolate, "flowrs"/"mal" = flower, "tegi"/"thagi" = gift, "kolombo" = Colombo). When calling tools ('call_shopper', 'call_logistics'), always translate Sinhala words or misspelled terms into clean English catalog search keywords (e.g., search 'cake', 'flower', 'chocolate') so the search returns exact items!

CRITICAL — Kapruka is NOT just gifts:
- Huge range: electronics, groceries, fashion, home essentials, beauty, kitchen, sports, toys, plus thousands of third-party sellers.
- MAJORITY of orders are everyday people shopping for THEMSELVES. Do NOT assume gifting unless stated.
- If self-shopping, skip gift message/sender fields. If gifting, proactively offer gift messages.

WHEN TO CALL AGENTS:
- User wants to find/browse/compare products → call_shopper
- User mentions a city, date, or delivery concern → call_logistics
- User wants to place an order or track one → call_checkout
- You can call MULTIPLE agents in one turn if needed (e.g., search + delivery check)
- For perishable items (cakes, flowers, fresh food), ALWAYS call both shopper AND logistics

COMPOSING YOUR RESPONSE:
- Never just parrot raw agent data. Curate it. Have an opinion. Highlight the best option.
- Suggest complementary items: cake? "Want candles too?" Phone? "Shall I find a case?"
- Never invent prices, stock, or delivery info. Use only what agents return.

DELIVERY COVERAGE POLICY (CRITICAL KNOWLEDGE):
- Kapruka offers ISLANDWIDE DELIVERY across Sri Lanka (all 25 districts, including Colombo, Kandy, Galle, Jaffna, Kurunegala, Negombo, etc.).
- If a user asks "What cities do you NOT deliver to?" or asks where Kapruka delivers, explain clearly that Kapruka delivers islandwide across practically all cities and towns in Sri Lanka. There is no excluded city list, though delivery fees and transit times vary depending on distance from dispatch centers.
`.trim();

const SHOPPER_PROMPT = `
You are the Shopper Agent for Kapruka — a specialist in catalog search, product discovery, and comparison.

Your job:
- Search the Kapruka catalog using kapruka_search_products
- Get detailed product info using kapruka_get_product
- Browse categories using kapruka_list_categories
- Return structured product data for the concierge to present

Guidelines:
- Always request response_format: json when possible
- Always request a high limit (e.g. limit: 40 or 50) when searching to cover a comprehensive catalog of items just like the Kapruka website.
- If a budget is mentioned, filter by price range.
- CRITICAL RECIPIENT & RELATIONSHIP FILTER: If the search is for a friend, colleague, sibling, partner, or general gift, explicitly avoid picking or returning products branded specifically 'For Mom', 'Mother', 'Amma', 'Dad', 'Father', or 'Thaththa' unless the user requested parents!
- SINHALA / SINGLISH & TYPO TOLERANCE: Always map Sinhala script words or Singlish/typo variations (e.g. 'කේක්' / 'kake' -> 'cake', 'මල්' / 'flowrs' -> 'flower', 'තෑගි' / 'tegi' -> 'gift') into English catalog terms when searching via kapruka_search_products.
- Search broadly first, then narrow if needed.
- Return ALL relevant product data (id, name, price, image, stock, category).
- If results are empty, try broader search terms without conversational modifier words.
- You are NOT user-facing. Return factual data, not conversational text.
`.trim();

const LOGISTICS_PROMPT = `
You are the Logistics Agent for Kapruka — a specialist in delivery validation and city resolution.

Your job:
- Resolve delivery cities using kapruka_list_delivery_cities
- Check delivery availability using kapruka_check_delivery
- Validate dates and city combinations

Guidelines:
- Always resolve the city name first before checking delivery
- Check delivery for perishable items (cakes, flowers, fresh food) proactively
- Return structured delivery data: city, date, availability, rate, warnings
- You are NOT user-facing. Return factual data, not conversational text.
- DELIVERY COVERAGE: Kapruka provides ISLANDWIDE delivery across Sri Lanka (all 25 districts). There are no excluded cities.
`.trim();

const CHECKOUT_PROMPT = `
You are the Checkout Agent for Kapruka — a specialist in order creation and tracking.

Your job:
- Create orders using kapruka_create_order
- Track orders using kapruka_track_order

Guidelines:
- For order creation, validate all required fields are present before calling the tool
- For tracking, extract and use the order number
- Return structured order data: payment URL, order number, status
- You are NOT user-facing. Return factual data, not conversational text.
`.trim();


function fallbackTools() {
  return [
    {
      name: 'kapruka_search_products',
      description: 'Search the Kapruka catalog by keyword, category, price range, stock, sort, pagination, and currency.',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          category: { type: 'string' },
          min_price: { type: 'number' },
          max_price: { type: 'number' },
          in_stock_only: { type: 'boolean' },
          sort: { type: 'string' },
          limit: { type: 'number' },
          cursor: { type: 'string' },
          currency: { type: 'string' },
        },
        required: ['q'],
      },
    },
    {
      name: 'kapruka_get_product',
      description: 'Get full details for a Kapruka product by product ID.',
      inputSchema: {
        type: 'object',
        properties: { product_id: { type: 'string' }, currency: { type: 'string' } },
        required: ['product_id'],
      },
    },
    {
      name: 'kapruka_list_categories',
      description: 'List top-level Kapruka categories and browse URLs.',
      inputSchema: {
        type: 'object',
        properties: { depth: { type: 'number' } },
      },
    },
    {
      name: 'kapruka_list_delivery_cities',
      description: 'Search Kapruka delivery cities by canonical name or alias.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, limit: { type: 'number' } },
        required: ['query'],
      },
    },
    {
      name: 'kapruka_check_delivery',
      description: 'Check delivery availability and rate for a city, date, and optional product.',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
          delivery_date: { type: 'string', description: 'YYYY-MM-DD' },
          product_id: { type: 'string' },
        },
        required: ['city', 'delivery_date'],
      },
    },
    {
      name: 'kapruka_create_order',
      description: 'Create a real guest-checkout order and return a click-to-pay URL.',
      inputSchema: {
        type: 'object',
        properties: {
          cart: { type: 'array', items: { type: 'object' } },
          recipient: { type: 'object' },
          delivery: { type: 'object' },
          sender: { type: 'object' },
          gift_message: { type: 'string' },
          currency: { type: 'string' },
        },
        required: ['cart', 'recipient', 'delivery', 'sender'],
      },
    },
    {
      name: 'kapruka_track_order',
      description: 'Track a Kapruka order by order number.',
      inputSchema: {
        type: 'object',
        properties: { order_number: { type: 'string' } },
        required: ['order_number'],
      },
    },
  ];
}

async function connectMcp() {
  if (mcpClient && mcpTools.length) return mcpClient;
  if (mcpConnectPromise) return mcpConnectPromise;

  mcpConnectPromise = (async () => {
    try {
      const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
      const client = new Client(
        { name: 'kapruka-senehasa-agent', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      const toolsResult = await client.listTools();
      mcpClient = client;
      mcpTools = (toolsResult.tools || []).filter((tool) => FALLBACK_TOOL_NAMES.includes(tool.name));
      mcpReadyAt = new Date().toISOString();
      lastMcpError = null;
      return client;
    } catch (error) {
      lastMcpError = error.message;
      mcpClient = null;
      mcpTools = [];
      throw error;
    } finally {
      mcpConnectPromise = null;
    }
  })();

  return mcpConnectPromise;
}

function openAiTools() {
  const tools = mcpTools.length ? mcpTools : fallbackTools();
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || `Call ${tool.name} on the Kapruka MCP.`,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

// ═══════════════════════════════════════════════════════════
// MULTI-AGENT ORCHESTRATION
// ═══════════════════════════════════════════════════════════

const SHOPPER_TOOL_NAMES = ['kapruka_search_products', 'kapruka_get_product', 'kapruka_list_categories'];
const LOGISTICS_TOOL_NAMES = ['kapruka_list_delivery_cities', 'kapruka_check_delivery'];
const CHECKOUT_TOOL_NAMES = ['kapruka_create_order', 'kapruka_track_order'];

function partitionedTools(toolNames) {
  const allTools = mcpTools.length ? mcpTools : fallbackTools();
  return allTools
    .filter((tool) => toolNames.includes(tool.name))
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || `Call ${tool.name} on the Kapruka MCP.`,
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    }));
}

async function runSubAgent({ agentPrompt, toolNames, taskDescription, context = {} }) {
  const subTools = partitionedTools(toolNames);
  const messages = [
    { role: 'system', content: agentPrompt },
    ...(Object.keys(context).length ? [{ role: 'system', content: `Context:\n${JSON.stringify(context)}` }] : []),
    { role: 'user', content: taskDescription },
  ];
  const products = [];
  const toolResults = [];

  for (let step = 0; step < 4; step += 1) {
    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: subTools.length ? subTools : undefined,
      tool_choice: subTools.length ? 'auto' : undefined,
      max_tokens: Number(process.env.MODEL_MAX_TOKENS || 4096),
      temperature: 0.3,
    });

    const responseMessage = completion.choices[0].message;
    messages.push(responseMessage);

    if (!responseMessage.tool_calls?.length) {
      return {
        text: messageContent(responseMessage),
        products,
        toolResults,
      };
    }

    for (const toolCall of responseMessage.tool_calls) {
      const functionName = toolCall.function.name;
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      const toolResult = await callKaprukaTool(functionName, args);
      const foundProducts = collectProducts(toolResult.data).concat(collectProducts(toolResult.raw));
      for (const product of foundProducts) {
        if (!products.some((item) => item.id === product.id)) products.push(product);
      }

      if (functionName === 'kapruka_create_order') {
        toolResults.push({ name: functionName, args, checkout: extractCheckout(toolResult.raw) });
      } else {
        toolResults.push({ name: functionName, args, text: toolResult.text, data: toolResult.data });
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: functionName,
        content: JSON.stringify(toolResult.data || toolResult.text || toolResult.raw).slice(0, 12000),
      });
    }
  }

  return { text: 'Sub-agent completed tool calls.', products, toolResults };
}

function conciergeTools() {
  return [
    {
      type: 'function',
      function: {
        name: 'call_shopper',
        description: 'Dispatch the Shopper Agent to search products, browse categories, compare items, or get product details from the Kapruka catalog.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'What to search for or do. E.g. "Search for birthday cakes under LKR 6000" or "Get details for product ID 12345" or "List all categories"',
            },
            budget_max: { type: 'number', description: 'Optional max budget in LKR' },
            budget_min: { type: 'number', description: 'Optional min budget in LKR' },
            category: { type: 'string', description: 'Optional category filter' },
          },
          required: ['task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'call_logistics',
        description: 'Dispatch the Logistics Agent to check delivery availability for a city and date, or resolve/list delivery cities.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'What to check. E.g. "Check delivery to Colombo on 2026-07-01" or "List delivery cities matching Kandy"',
            },
            city: { type: 'string', description: 'Delivery city name' },
            delivery_date: { type: 'string', description: 'Delivery date (YYYY-MM-DD)' },
            product_id: { type: 'string', description: 'Optional product ID for specific delivery check' },
          },
          required: ['task'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'call_checkout',
        description: 'Dispatch the Checkout Agent to create an order or track an existing order.',
        parameters: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'What to do. E.g. "Track order KAP-12345" or "Create order with provided cart and details"',
            },
            order_number: { type: 'string', description: 'Order number to track (for tracking)' },
            order_details: {
              type: 'object',
              description: 'Full order details for creation (cart, recipient, delivery, sender, gift_message)',
            },
          },
          required: ['task'],
        },
      },
    },
  ];
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeMcpResult(result) {
  if (!result) return {};

  const normalized = {
    raw: result,
    text: '',
    data: result.structuredContent || null,
  };

  if (typeof result.structuredContent?.result === 'string') {
    normalized.data = parseJsonMaybe(result.structuredContent.result);
  }

  if (Array.isArray(result.content)) {
    const textParts = [];
    const dataParts = [];

    for (const part of result.content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        textParts.push(part.text);
        dataParts.push(parseJsonMaybe(part.text));
      } else if ('json' in part) {
        dataParts.push(part.json);
      } else if ('data' in part) {
        dataParts.push(part.data);
      }
    }

    normalized.text = textParts.join('\n\n');
    if (!normalized.data) {
      normalized.data = dataParts.length === 1 ? dataParts[0] : dataParts;
    }
  }

  return normalized;
}

function moneyValue(value) {
  if (value && typeof value === 'object' && 'amount' in value) return moneyValue(value.amount);
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function findImage(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  if (Array.isArray(value)) return value.map(findImage).find(Boolean) || null;
  if (typeof value === 'object') {
    return findImage(value.url || value.src || value.image || value.large || value.medium || value.thumbnail);
  }
  return null;
}

function normalizeProduct(product) {
  if (!product || typeof product !== 'object') return null;

  const id = String(firstValue(
    product.id,
    product.product_id,
    product.productId,
    product.code,
    product.item_code,
    product.sku,
    product.product_code,
  ) || '');
  const name = firstValue(product.name, product.title, product.product_name, product.productName);

  if (!id || !name) return null;

  const priceLKR = moneyValue(firstValue(
    product.priceLKR,
    product.price_lkr,
    product.lkr_price,
    product.price,
    product.current_price,
    product.sale_price,
  ));
  const priceUSD = moneyValue(firstValue(product.priceUSD, product.price_usd, product.usd_price));
  const image = findImage(firstValue(product.image, product.image_url, product.images, product.thumbnail, product.photo));
  const stockValue = firstValue(product.inStock, product.in_stock, product.available, product.stock, product.is_available);
  const categoryValue = firstValue(product.category, product.category_name, product.department, product.type, 'Kapruka');
  const category = typeof categoryValue === 'object'
    ? firstValue(categoryValue.name, categoryValue.slug, categoryValue.id, 'Kapruka')
    : categoryValue;

  return {
    id,
    product_id: id,
    name: String(name),
    priceLKR: priceLKR || 0,
    priceUSD: priceUSD || null,
    image,
    isFresh: /cake|flower|fresh|combo/i.test(`${category} ${name}`),
    inStock: typeof stockValue === 'boolean' ? stockValue : !/sold|out of stock|unavailable/i.test(String(stockValue || '')),
    category: String(category),
    url: firstValue(product.url, product.product_url, product.link),
    raw: product,
  };
}

function filterRelevantProducts(products = [], userText = '') {
  if (!Array.isArray(products) || !products.length) return [];
  const text = normalizeShoppingTerms(userText).toLowerCase();

  const wantsMom = /\b(mom|mother|amma|mummy|mum|ammi)\b/i.test(text);
  const wantsDad = /\b(dad|father|thaththa|daddy|papa|thaathi)\b/i.test(text);
  const mentionsOtherRelation = /\b(friend|frnd|yaluwa|colleague|brother|sister|malli|ayya|nangi|akka|bf|gf|boyfriend|girlfriend|partner|husband|wife|babe|kid|child|son|daughter)\b/i.test(text);

  const filtered = products.filter((product) => {
    if (!product || !product.name) return false;
    const nameStr = `${product.name} ${product.category || ''}`.toLowerCase();

    if (!wantsMom && /\b(for mom|for mother|to mom|amma|mother's day|moms birthday)\b/i.test(nameStr)) {
      if (mentionsOtherRelation || !wantsMom) return false;
    }
    if (!wantsDad && /\b(for dad|for father|to dad|thaththa|father's day|dads birthday)\b/i.test(nameStr)) {
      if (mentionsOtherRelation || !wantsDad) return false;
    }
    return true;
  });

  return filtered.length > 0 ? filtered : products;
}

function collectProducts(value, products = []) {
  if (!value || products.length >= 100) return products;

  if (Array.isArray(value)) {
    for (const item of value) collectProducts(item, products);
    return products;
  }

  if (typeof value !== 'object') return products;

  const normalized = normalizeProduct(value);
  if (normalized && !products.some((item) => item.id === normalized.id)) {
    products.push(normalized);
  }

  for (const key of ['products', 'results', 'items', 'data', 'product', 'matches']) {
    if (value[key]) collectProducts(value[key], products);
  }

  return products;
}

function collectUrls(value, urls = []) {
  if (!value) return urls;
  if (typeof value === 'string') {
    const matches = value.match(/https?:\/\/[^\s)"]+/g) || [];
    urls.push(...matches);
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls));
    return urls;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectUrls(item, urls));
  }
  return urls;
}

function extractCheckout(result) {
  const normalized = normalizeMcpResult(result);
  const urls = collectUrls(normalized);
  const paymentUrl = urls.find((url) => /pay|checkout|payment|kapruka/i.test(url)) || urls[0] || null;
  const payload = JSON.stringify(normalized.data || normalized.raw || {});
  const orderMatch = payload.match(/(?:order_number|orderNo|order_id|orderId)"?\s*[:=]\s*"?([A-Za-z0-9-]+)/i);

  return {
    paymentUrl,
    orderNumber: orderMatch?.[1] || null,
    text: normalized.text,
    data: normalized.data,
  };
}

async function callKaprukaTool(name, args = {}) {
  await connectMcp();
  const tool = mcpTools.find((item) => item.name === name);
  const requiresParams = tool?.inputSchema?.required?.includes('params');
  const normalizedArgs = requiresParams && !Object.hasOwn(args, 'params') ? { params: args } : args;

  if (normalizedArgs.params && !normalizedArgs.params.response_format && name !== 'kapruka_create_order') {
    normalizedArgs.params.response_format = 'json';
  }

  const result = await mcpClient.callTool({ name, arguments: normalizedArgs });
  return normalizeMcpResult(result);
}

function buildCreateOrderPayload(body = {}) {
  return {
    cart: (body.cart || []).map((item) => ({
      product_id: item.product_id || item.id,
      quantity: Number(item.quantity || 1),
    })),
    recipient: {
      name: body.recipient?.name || body.recipientName,
      phone: body.recipient?.phone || body.recipientPhone,
    },
    delivery: {
      address: body.delivery?.address || body.delivery?.delivery_address || body.recipient?.address || body.recipientAddress,
      city: body.delivery?.city || body.city,
      date: body.delivery?.date || body.delivery?.delivery_date || body.deliveryDate,
      instructions: body.delivery?.instructions || body.instructions || null,
    },
    sender: {
      name: body.sender?.name || body.senderName,
      phone: body.sender?.phone || body.senderPhone || null,
      email: body.sender?.email || body.senderEmail || null,
      anonymous: Boolean(body.sender?.anonymous || body.anonymous),
    },
    gift_message: body.gift_message || body.giftMessage || '',
    currency: body.currency || 'LKR',
  };
}

function messageContent(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.map((part) => part.text || '').join('\n');
  }
  return '';
}

function sanitizeMessages(messages = []) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.content)
    .slice(-18)
    .map((message) => ({
      role: message.role,
      content: String(message.content).slice(0, 6000),
    }));
}

function latestUserMessage(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
      return message.content.trim();
    }
  }
  return '';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactText(value) {
  return normalizeText(String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' '));
}

function bestObjectLabel(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return normalizeText(firstValue(
    value.city,
    value.name,
    value.canonical_name,
    value.canonicalCity,
    value.label,
    value.display_name,
    value.title,
    value.slug,
    value.alias,
  ));
}

function collectDeliveryCityLabels(value, labels = []) {
  if (!value) return labels;

  if (Array.isArray(value)) {
    for (const item of value) collectDeliveryCityLabels(item, labels);
    return labels;
  }

  if (typeof value === 'string') {
    const text = normalizeText(value);
    if (text) labels.push(text);
    return labels;
  }

  if (typeof value !== 'object') return labels;

  const direct = bestObjectLabel(value);
  if (direct) labels.push(direct);

  for (const key of ['cities', 'city', 'results', 'items', 'data', 'matches', 'options']) {
    if (value[key]) collectDeliveryCityLabels(value[key], labels);
  }

  return labels;
}

function normalizeShoppingTerms(text = '') {
  let normalized = String(text || '');
  const corrections = [
    // Cakes
    [/\b(kake|keek|kaak|caak|cak|caek|කේක්)\b/gi, 'cake'],
    // Flowers
    [/\b(flowr|flowrs|flwer|flwers|flour|floer|mal|mahl|මල්)\b/gi, 'flower'],
    // Chocolates
    [/\b(choclet|chocklet|choko|chocolat|choklat|chocolates|චොකලට්|චොක්ලට්)\b/gi, 'chocolate'],
    // Gifts & Hampers
    [/\b(tegi|thegi|thaagi|thagi|giftz|gif|gft|තෑගි|තෑග්ග)\b/gi, 'gift'],
    [/\b(hampur|hampre|hmper|hampa|හැම්පර්)\b/gi, 'hamper'],
    // Groceries & Fruits
    [/\b(frut|fruts|fuit|palathuru|palaturu|පළතුරු)\b/gi, 'fruit'],
    [/\b(grocry|grocries|badu|kama|කෑම|බඩු)\b/gi, 'groceries'],
    // Electronics
    [/\b(phon|fon|foan|ෆෝන්)\b/gi, 'phone'],
    [/\b(chargr|charger|චාජර්)\b/gi, 'charger'],
    [/\b(watc|wtch|ඔරලෝසු)\b/gi, 'watch'],
    // Common Sinhala / Singlish relations
    [/\b(amma|ammi|අම්මා|අම්මගෙ|අම්මට)\b/gi, 'mom'],
    [/\b(thaththa|thaathi|තාත්තා|තාත්තට)\b/gi, 'dad'],
    [/\b(yaluwa|yaluwata|frnd|freind|frend|යාළුවා)\b/gi, 'friend'],
    // Cities
    [/\b(kolombo|klmbo|colombu|clmbo|කොළඹ|කොලඹ)\b/gi, 'Colombo'],
    [/\b(kndi|kandi|නුවර|මහනුවර)\b/gi, 'Kandy'],
    [/\b(gale|ගාල්ල)\b/gi, 'Galle'],
    [/\b(jafna|යාපනය)\b/gi, 'Jaffna'],
    [/\b(negambo|negambu|මීගමුව)\b/gi, 'Negombo'],
    [/\b(kurunegla|kurunaegala|කුරුණෑගල)\b/gi, 'Kurunegala'],
  ];

  for (const [pattern, replacement] of corrections) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

async function resolveDeliveryCity(cityInput) {
  const query = normalizeText(normalizeShoppingTerms(cityInput));
  if (!query) return '';

  try {
    const result = await callKaprukaTool('kapruka_list_delivery_cities', { query, limit: 10 });
    const labels = [...new Set(collectDeliveryCityLabels(result.data).concat(collectDeliveryCityLabels(result.raw)))];
    if (!labels.length) return query;

    const compactQuery = compactText(query);
    const exact = labels.find((label) => compactText(label) === compactQuery);
    if (exact) return exact;

    const containsQuery = labels.find((label) => compactText(label).includes(compactQuery) || compactQuery.includes(compactText(label)));
    if (containsQuery) return containsQuery;

    const firstPart = query.split(/\s+/)[0];
    const firstMatch = labels.find((label) => compactText(label).includes(compactText(firstPart)));
    return firstMatch || labels[0] || query;
  } catch {
    return query;
  }
}

function extractKnownCity(text = '') {
  const normalizedText = normalizeShoppingTerms(text);
  const knownCities = ['Colombo', 'Kandy', 'Galle', 'Jaffna', 'Negombo', 'Matara', 'Kurunegala', 'Gampaha', 'Kalutara', 'Anuradhapura', 'Nuwara Eliya', 'Ratnapura', 'Batticaloa', 'Trincomalee', 'Nuwara'];
  const found = knownCities.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(normalizedText));
  if (found) return found === 'Nuwara' ? 'Nuwara Eliya' : found;
  const match = normalizedText.match(/\b(?:in|to|for|at|walata|ekata|ta)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/i);
  return match?.[1] || '';
}

function extractOrderNumber(text = '') {
  const match = text.match(/\b(?:order\s*(?:number|no\.?|id)?\s*[:#-]?\s*)?([A-Za-z0-9-]{6,})\b/i);
  return match?.[1] || '';
}

function extractDateFromText(text = '') {
  const normalized = text.toLowerCase();
  const today = new Date();

  if (/\btoday\b/.test(normalized)) return today.toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(normalized)) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  }
  if (/\bday after tomorrow\b/.test(normalized)) {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter.toISOString().slice(0, 10);
  }
  if (/\bnext week\b/.test(normalized)) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return nextWeek.toISOString().slice(0, 10);
  }

  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] || '';
}

function wantsDeliveryCheck(text = '') {
  return /\b(deliver|delivery|check delivery|available in|send to|yawanna|karanawada|yawamu)\b/i.test(text) || /\b(tomorrow|today|date|ada|het|heta)\b/i.test(text);
}

function wantsTrackOrder(text = '') {
  return /\b(track|tracking|order status|where is my order)\b/i.test(text);
}

function wantsCheckout(text = '') {
  return /\b(checkout|checkout link|pay link|payment|place order|buy now)\b/i.test(text);
}

function wantsBrowseCategories(text = '') {
  return /\b(category|categories|browse|shop by|what can i buy|show me ideas)\b/i.test(text);
}

function wantsSearch(text = '') {
  const normalizedText = normalizeShoppingTerms(text);
  return /\b(search|find|show me|recommend|suggest|gift|cake|flower|hamper|chocolate|toy|birthday|anniversary|wedding|combo|ona|ekak|yawanna|mal|thegi|kasi|kande|badu|phone|charger|groceries|shoe|shoes|watch|electronic|fruit)\b/i.test(normalizedText) || /[\u0D80-\u0DFF]/.test(text);
}

function extractSearchQuery(text = '') {
  const normalizedText = normalizeShoppingTerms(text);
  const cleaned = normalizeText(
    normalizedText
      .replace(/\b(please|kindly|can you|could you|show me|find|search|recommend|suggest|for me|under|less than|below|around|near|to|in|at|i|want|need|looking|some|good|best|buy|get|give|send|my|a|an|the|friend|frnd|yaluwa|colleague|brother|sister|ona|ekak|yawanna)\b/gi, ' ')
      .replace(/\b(today|tomorrow|day after tomorrow|next week|this week|ada|heta)\b/gi, ' ')
      .replace(/\b(lkr|rs|rupees?|budget|\d+)\b/gi, ' '),
  );
  if (!cleaned || cleaned === 'gift' || cleaned === 'gifts') return 'gift hamper chocolate';
  return cleaned || normalizeText(normalizedText);
}

function missingCheckoutFields(checkoutDetails = {}) {
  return [
    ['recipientName', 'recipient name'],
    ['recipientPhone', 'recipient phone'],
    ['recipientAddress', 'delivery address'],
    ['city', 'delivery city'],
    ['deliveryDate', 'delivery date'],
    ['senderName', 'sender name'],
    ['senderPhone', 'sender phone'],
    ['senderEmail', 'sender email'],
  ]
    .filter(([field]) => !String(checkoutDetails[field] || '').trim())
    .map(([, label]) => label);
}

function formatMcpText(result, fallback = '') {
  const text = normalizeText(result?.text || '');
  if (text) return text;
  if (typeof result?.data === 'string' && result.data.trim()) return result.data.trim();
  if (Array.isArray(result?.data)) return fallback;
  return fallback;
}

async function runFallbackChat({ messages = [], context = {} }) {
  const userText = latestUserMessage(messages);
  const userName = context.userName ? String(context.userName).trim() : '';
  const cart = Array.isArray(context.cart) ? context.cart : [];
  const checkoutDetails = context.checkoutDetails || {};
  const toolResults = [];
  const products = [];
  const lowerText = userText.toLowerCase();

  if (!userText) {
    return {
      role: 'assistant',
      content: userName ? `Hi ${userName}! Tell me what you want to shop for, or share a delivery city and date and I will start from there.` : 'Tell me what you want to shop for, or share a delivery city and date and I will start from there.',
      products,
      toolResults,
      mode: 'fallback',
    };
  }

  const orderNumber = extractOrderNumber(userText);
  if (wantsTrackOrder(userText) || orderNumber) {
    if (!orderNumber) {
      return {
        role: 'assistant',
        content: 'Share your Kapruka order number and I will track it for you right away.',
        products,
        toolResults,
        mode: 'fallback',
      };
    }
    const tracked = await callKaprukaTool('kapruka_track_order', { order_number: orderNumber });
    toolResults.push({ name: 'kapruka_track_order', args: { order_number: orderNumber }, text: tracked.text, data: tracked.data });
    return {
      role: 'assistant',
      content: formatMcpText(tracked, `I checked order ${orderNumber}.`),
      products,
      toolResults,
      mode: 'fallback',
    };
  }

  if (wantsCheckout(userText)) {
    const missingFields = missingCheckoutFields(checkoutDetails);
    if (!cart.length) {
      return {
        role: 'assistant',
        content: 'Add at least one item to the cart and I can create a checkout link.',
        products,
        toolResults,
        mode: 'fallback',
      };
    }
    if (missingFields.length) {
      return {
        role: 'assistant',
        content: `I’m ready for checkout, but I still need: ${missingFields.join(', ')}.`,
        products,
        toolResults,
        mode: 'fallback',
      };
    }

    const checkoutResult = await callKaprukaTool('kapruka_create_order', buildCreateOrderPayload({
      cart,
      recipient: {
        name: checkoutDetails.recipientName,
        phone: checkoutDetails.recipientPhone,
        address: checkoutDetails.recipientAddress,
      },
      delivery: {
        city: checkoutDetails.city,
        address: checkoutDetails.recipientAddress,
        date: checkoutDetails.deliveryDate,
      },
      sender: {
        name: checkoutDetails.senderName,
        phone: checkoutDetails.senderPhone,
        email: checkoutDetails.senderEmail,
      },
      gift_message: checkoutDetails.giftMessage,
    }));

    const checkout = extractCheckout(checkoutResult.raw || checkoutResult);
    toolResults.push({
      name: 'kapruka_create_order',
      args: buildCreateOrderPayload({
        cart,
        recipient: {
          name: checkoutDetails.recipientName,
          phone: checkoutDetails.recipientPhone,
          address: checkoutDetails.recipientAddress,
        },
        delivery: {
          city: checkoutDetails.city,
          address: checkoutDetails.recipientAddress,
          date: checkoutDetails.deliveryDate,
        },
        sender: {
          name: checkoutDetails.senderName,
          phone: checkoutDetails.senderPhone,
          email: checkoutDetails.senderEmail,
        },
        gift_message: checkoutDetails.giftMessage,
      }),
      checkout,
    });

    return {
      role: 'assistant',
      content: checkout.paymentUrl
        ? `Your checkout is ready. [Open checkout to pay](${checkout.paymentUrl})`
        : 'I created the checkout request, but Kapruka did not return a payment link in the response.',
      products,
      toolResults,
      mode: 'fallback',
    };
  }

  const city = normalizeText(checkoutDetails.city || extractKnownCity(userText));
  const deliveryDate = normalizeText(checkoutDetails.deliveryDate || extractDateFromText(userText));
  const searchQuery = extractSearchQuery(userText);
  const productMatches = /(cake|flower|gift|hamper|chocolate|combo|toy|biscuit|snack|fragrance|perfume|cake|wedding|birthday|ona|ekak|mal|thegi|phone|charger|groceries|shoe|shoes|watch|electronic|කේක්|මල්|තෑගි|උපන්දින|අම්මා|තාත්තා)/i.test(userText) || /[\u0D80-\u0DFF]/.test(userText);

  if (/\b(where do you deliver|cities|islandwide|deliver everywhere|don't deliver|do not deliver|delivery coverage|delivery locations)\b/i.test(userText) && !city) {
    return {
      role: 'assistant',
      content: 'Kapruka offers **islandwide delivery** across Sri Lanka! 🚚✨ We deliver to practically all cities and towns across all 25 districts (including Colombo, Kandy, Galle, Jaffna, Negombo, Kurunegala, and more). Delivery rates and transit times vary depending on the distance from our dispatch centers. Let me know your delivery city and date, and I can check specific availability for your items!',
      products,
      toolResults,
      mode: 'fallback',
    };
  }

  if ((wantsDeliveryCheck(userText) || productMatches) && city && deliveryDate) {
    const resolvedCity = await resolveDeliveryCity(city);
    const deliveryCheck = await callKaprukaTool('kapruka_check_delivery', {
      city: resolvedCity,
      delivery_date: deliveryDate,
      product_id: cart[0]?.product_id || cart[0]?.id,
    });
    toolResults.push({
      name: 'kapruka_check_delivery',
      args: {
        city: resolvedCity,
        delivery_date: deliveryDate,
        product_id: cart[0]?.product_id || cart[0]?.id,
      },
      text: deliveryCheck.text,
      data: deliveryCheck.data,
    });

    if (!wantsSearch(userText) && !productMatches) {
      return {
        role: 'assistant',
        content: formatMcpText(deliveryCheck, `Delivery availability checked for ${resolvedCity} on ${deliveryDate}.`),
        products,
        toolResults,
        mode: 'fallback',
      };
    }
  }

  if (wantsBrowseCategories(userText)) {
    const categories = await callKaprukaTool('kapruka_list_categories', { depth: 1 });
    toolResults.push({ name: 'kapruka_list_categories', args: { depth: 1 }, text: categories.text, data: categories.data });
    return {
      role: 'assistant',
      content: formatMcpText(categories, 'I pulled the main Kapruka categories for you.'),
      products,
      toolResults,
      mode: 'fallback',
    };
  }

  if (wantsSearch(userText) || productMatches || lowerText.includes(' under ') || lowerText.includes(' around ')) {
    const search = await callKaprukaTool('kapruka_search_products', {
      q: searchQuery,
      limit: 40,
      currency: 'LKR',
    });
    const foundProducts = collectProducts(search.data).concat(collectProducts(search.raw));
    for (const product of foundProducts) {
      if (!products.some((item) => item.id === product.id)) products.push(product);
    }
    toolResults.push({ name: 'kapruka_search_products', args: { q: searchQuery, limit: 40, currency: 'LKR' }, text: search.text, data: search.data });

    const filteredProducts = filterRelevantProducts(products, userText);
    const searchText = formatMcpText(search, `Here are live Kapruka results for ${searchQuery}.`);
    const deliveryLine = city && deliveryDate && wantsDeliveryCheck(userText)
      ? ` I also checked delivery for ${city} on ${deliveryDate}.`
      : '';
    const prefix = (userName && messages.length <= 2) ? `Hi ${userName}! ` : '';
    return {
      role: 'assistant',
      content: `${prefix}${searchText}${deliveryLine}`.trim(),
      products: filteredProducts,
      toolResults,
      mode: 'fallback',
    };
  }

  return {
    role: 'assistant',
    content: userName ? `Hi ${userName}! I can search the Kapruka catalog, compare products, check delivery, build a cart, or track an order. Tell me the gift, city, and date and I’ll take it from there.` : 'I can search the Kapruka catalog, compare products, check delivery, build a cart, or track an order. Tell me the gift, city, and date and I’ll take it from there.',
    products: filterRelevantProducts(products, userText),
    toolResults,
    mode: 'fallback',
  };
}

app.get('/health', async (req, res) => {
  res.json({
    ok: true,
    architecture: 'multi-agent',
    agents: ['concierge', 'shopper', 'logistics', 'checkout'],
    modelProvider: MODEL_PROVIDER,
    model: MODEL,
    modelBaseUrl: MODEL_BASE_URL,
    modelConfigured: hasApiKey(),
    chatMode: hasApiKey() ? 'multi-agent' : 'fallback',
    mcpReady: Boolean(mcpClient && mcpTools.length),
    mcpReadyAt,
    toolCount: mcpTools.length,
    lastMcpError,
  });
});

app.get('/api/tools', async (req, res) => {
  try {
    await connectMcp();
    res.json({ tools: mcpTools });
  } catch (error) {
    res.status(503).json({ error: 'Kapruka MCP is unavailable', detail: error.message, tools: fallbackTools() });
  }
});

app.post('/api/mcp/:toolName', async (req, res) => {
  try {
    const { toolName } = req.params;
    if (!FALLBACK_TOOL_NAMES.includes(toolName)) {
      res.status(404).json({ error: 'Unknown Kapruka tool' });
      return;
    }
    const body = req.body || {};
    if (toolName === 'kapruka_check_delivery') {
      const resolvedCity = await resolveDeliveryCity(body.city);
      const result = await callKaprukaTool(toolName, {
        ...body,
        city: resolvedCity,
      });
      res.json({ ...result, resolvedCity });
      return;
    }
    const result = await callKaprukaTool(toolName, body);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: 'Kapruka MCP call failed', detail: error.message });
  }
});

app.post('/api/checkout', async (req, res) => {
  try {
    const body = req.body || {};
    const resolvedCity = await resolveDeliveryCity(body.delivery?.city || body.city || body.checkoutDetails?.city || '');
    const payload = buildCreateOrderPayload({
      ...body,
      delivery: {
        ...(body.delivery || {}),
        city: resolvedCity || body.delivery?.city || body.city,
      },
    });
    const result = await callKaprukaTool('kapruka_create_order', payload);
    res.json(extractCheckout(result.raw || result));
  } catch (error) {
    res.status(502).json({ error: 'Checkout creation failed', detail: error.message });
  }
});

app.post('/api/track', async (req, res) => {
  try {
    const result = await callKaprukaTool('kapruka_track_order', req.body || {});
    res.json(result);
  } catch (error) {
    if (/order_not_found|no order exists/i.test(error.message || '')) {
      res.status(404).json({
        error: 'Order not found',
        detail: 'I could not find that order number. Please check it and try again.',
      });
      return;
    }
    res.status(502).json({ error: 'Order tracking failed', detail: error.message });
  }
});

app.post('/api/delivery-check', async (req, res) => {
  try {
    const body = req.body || {};
    const resolvedCity = await resolveDeliveryCity(body.city);
    if (!resolvedCity) {
      res.status(400).json({ error: 'City is required for delivery checks' });
      return;
    }

    const result = await callKaprukaTool('kapruka_check_delivery', {
      city: resolvedCity,
      delivery_date: body.delivery_date,
      product_id: body.product_id,
    });

    res.json({
      ...result,
      resolvedCity,
    });
  } catch (error) {
    res.status(502).json({ error: 'Delivery check failed', detail: error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    if (!hasApiKey()) {
      const fallback = await runFallbackChat({
        messages: sanitizeMessages(req.body?.messages),
        context: req.body?.context || {},
      });
      res.json(fallback);
      return;
    }

    await connectMcp();

    const shopperContext = req.body?.context || {};
    const userName = shopperContext.userName ? String(shopperContext.userName).trim() : '';
    const messages = [
      { role: 'system', content: CONCIERGE_PROMPT },
      ...(userName ? [{ role: 'system', content: `The user's name is ${userName}. Greet them warmly as "Hi ${userName}!" or use their name naturally. Do NOT call them "machan" or "aiyo".` }] : []),
      ...(Object.keys(shopperContext).length ? [{ role: 'system', content: `Current shopper context:\n${JSON.stringify(shopperContext)}` }] : []),
      ...sanitizeMessages(req.body?.messages),
    ];
    const allProducts = [];
    const allToolResults = [];

    // Concierge loop — the concierge dispatches to sub-agents via internal tools
    for (let step = 0; step < 6; step += 1) {
      const completion = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: conciergeTools(),
        tool_choice: 'auto',
        max_tokens: Number(process.env.MODEL_MAX_TOKENS || 4096),
        temperature: Number(process.env.MODEL_TEMPERATURE || 1),
        top_p: Number(process.env.MODEL_TOP_P || 0.95),
      });

      const responseMessage = completion.choices[0].message;
      messages.push(responseMessage);

      // No tool calls — concierge is done, return the final response
      if (!responseMessage.tool_calls?.length) {
        const generatedText = messageContent(responseMessage);
        const userText = latestUserMessage(req.body?.messages);
        res.json({
          role: 'assistant',
          content: generatedText || 'Kapruka offers islandwide delivery across Sri Lanka! Tell me what product or delivery city you are looking for, and I will check availability for you right away.',
          products: filterRelevantProducts(allProducts, userText),
          toolResults: allToolResults,
          agents: ['concierge', ...allToolResults.map((r) => r.agent).filter(Boolean)],
        });
        return;
      }

      // Process each concierge tool call (sub-agent dispatch)
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        let subResult;

        if (functionName === 'call_shopper') {
          console.log(`[Concierge → Shopper] ${args.task}`);
          subResult = await runSubAgent({
            agentPrompt: SHOPPER_PROMPT,
            toolNames: SHOPPER_TOOL_NAMES,
            taskDescription: args.task + (args.budget_max ? ` (budget max: LKR ${args.budget_max})` : '') + (args.category ? ` (category: ${args.category})` : ''),
            context: shopperContext,
          });
          for (const product of subResult.products) {
            if (!allProducts.some((item) => item.id === product.id)) allProducts.push(product);
          }
          for (const tr of subResult.toolResults) {
            allToolResults.push({ ...tr, agent: 'shopper' });
          }
        } else if (functionName === 'call_logistics') {
          console.log(`[Concierge → Logistics] ${args.task}`);
          subResult = await runSubAgent({
            agentPrompt: LOGISTICS_PROMPT,
            toolNames: LOGISTICS_TOOL_NAMES,
            taskDescription: args.task + (args.city ? ` (city: ${args.city})` : '') + (args.delivery_date ? ` (date: ${args.delivery_date})` : '') + (args.product_id ? ` (product: ${args.product_id})` : ''),
            context: shopperContext,
          });
          for (const tr of subResult.toolResults) {
            allToolResults.push({ ...tr, agent: 'logistics' });
          }
        } else if (functionName === 'call_checkout') {
          console.log(`[Concierge → Checkout] ${args.task}`);
          const taskDesc = args.order_number
            ? `Track order ${args.order_number}`
            : args.task + (args.order_details ? `\nOrder details: ${JSON.stringify(args.order_details)}` : `\nShopper context: ${JSON.stringify(shopperContext)}`);
          subResult = await runSubAgent({
            agentPrompt: CHECKOUT_PROMPT,
            toolNames: CHECKOUT_TOOL_NAMES,
            taskDescription: taskDesc,
            context: shopperContext,
          });
          for (const tr of subResult.toolResults) {
            allToolResults.push({ ...tr, agent: 'checkout' });
          }
        } else {
          subResult = { text: `Unknown agent: ${functionName}`, products: [], toolResults: [] };
        }

        // Feed sub-agent results back to the concierge
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: functionName,
          content: JSON.stringify({
            agent_response: subResult.text,
            products_found: subResult.products?.length || 0,
            product_summaries: (subResult.products || []).slice(0, 8).map((p) => ({
              id: p.id,
              name: p.name,
              priceLKR: p.priceLKR,
              image: p.image,
              category: p.category,
              inStock: p.inStock,
            })),
            tool_results: subResult.toolResults,
          }).slice(0, 12000),
        });
      }
    }

    const userText = latestUserMessage(req.body?.messages);
    res.json({
      role: 'assistant',
      content: 'I checked with my team, but I need one more detail. Could you rephrase with the city, date, or item you need?',
      products: filterRelevantProducts(allProducts, userText),
      toolResults: allToolResults,
      agents: ['concierge'],
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      error: 'Chat failed',
      detail: error.message,
      content: 'I could not reach the live shopping tools just now. Please try again in a moment.',
      products: [],
    });
  }
});

if (!process.env.VERCEL) {
  connectMcp().catch((error) => {
    console.error('Initial Kapruka MCP connection failed:', error.message);
  });
}

app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Senehasa API</title>
        <style>
          body { font-family: system-ui, sans-serif; margin: 0; padding: 40px; background: #0a0e1a; color: #f8fafc; }
          .card { max-width: 720px; margin: 0 auto; padding: 24px; border: 1px solid rgba(148,163,184,.18); border-radius: 16px; background: rgba(15,20,42,.8); }
          a { color: #f59e0b; }
          code { background: rgba(255,255,255,.08); padding: 2px 6px; border-radius: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Senehasa backend is running</h1>
          <p>This server exposes the Kapruka shopping API. Open the frontend in your Vite dev server for the full experience.</p>
          <p>API health: <a href="/health">/health</a></p>
          <p>Chat endpoint: <code>/api/chat</code></p>
          <p>If you are developing locally, run the frontend and open <code>http://localhost:5173</code>.</p>
        </div>
      </body>
    </html>
  `);
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
  });
}

export default app;
