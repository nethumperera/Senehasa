# Senehasa

Senehasa is a conversational shopping assistant for Kapruka. It helps users discover products, compare options, check delivery availability, manage a cart, create guest checkout requests, and track orders through a chat-first interface.

This repository contains two parts:

- `frontend`: a React + Vite single-page app
- `backend`: an Express API that connects the UI to Kapruka's live tools and AI model providers

## What This Project Does

Senehasa is designed to make shopping feel like a conversation instead of a category search.

Users can:

- search for products by natural language
- browse categories and discover gift ideas
- add products to a cart
- check delivery availability by city and date
- create checkout requests
- track Kapruka orders

The assistant is built to be useful for gift shopping, especially for cakes, flowers, hampers, and date-sensitive deliveries.

## Why It Exists

This project was built for the Kapruka challenge as a practical AI shopping assistant. The goal is to show how a modern frontend, a lightweight backend, and live external tools can work together to create a real shopping flow:

1. discover products
2. verify delivery
3. build a cart
4. create checkout
5. track the order

## Repository Structure

```text
Kapruka/
  backend/
    index.js
    package.json
    .env.example
  frontend/
    src/
    public/
    vite.config.js
    vercel.json
    .env.example
  README.md
  VERCEL_DEPLOYMENT.md
```

## Architecture

### Frontend

The frontend is a React application built with Vite. It handles:

- the chat interface
- product cards
- cart state
- checkout details
- delivery check UI
- order tracking UI
- theme and local storage persistence

The frontend calls the backend through `VITE_API_BASE_URL`.

### Backend

The backend is an Express server that:

- exposes `/api/chat`, `/api/checkout`, `/api/track`, `/api/delivery-check`, `/api/mcp/:toolName`, and `/health`
- connects to Kapruka MCP tools
- calls the configured model provider
- formats tool responses for the frontend
- falls back to deterministic chat behavior if no model API key is available

### External Services

The backend is designed around these dependencies:

- Kapruka MCP endpoint
- NVIDIA or OpenRouter model API

## Key Features

- Conversational product search
- Live tool-based catalog access
- Delivery city resolution
- Delivery availability checks
- Cart and checkout workflow
- Order tracking
- Guest checkout support
- Mobile-friendly layout
- Dark/light theme switch
- Persistent cart and checkout form state

## How The Flow Works

### 1. User asks in chat

The user can ask things like:

- "Birthday cake for Colombo tomorrow under LKR 6000"
- "Gift hamper for Amma in Kandy"
- "Track my Kapruka order"

### 2. Frontend sends context

The frontend sends:

- recent chat messages
- cart items
- checkout details

### 3. Backend interprets intent

The backend decides whether it should:

- search products
- check delivery
- track an order
- create checkout
- call the AI model for a richer answer

### 4. Backend returns structured results

The response can contain:

- assistant text
- product cards
- tool results
- checkout metadata

### 5. Frontend renders the experience

The UI shows:

- chat bubbles
- product cards
- cart summary
- delivery state
- tracking status
- checkout state

## Local Development

### Prerequisites

- Node.js 20 or newer
- npm

### 1. Install dependencies

From the repo root:

```bash
cd frontend
npm install

cd ../backend
npm install
```

### 2. Configure environment variables

Copy the example files and fill in your values.

Frontend:

```bash
VITE_API_BASE_URL=http://localhost:3001
```

Backend:

```bash
PORT=3001
KAPRUKA_MCP_URL=https://mcp.kapruka.com/mcp
MODEL_PROVIDER=nvidia
NVIDIA_API_KEY=your_key_here
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=google/diffusiongemma-26b-a4b-it
CORS_ORIGIN=http://localhost:5173
APP_PUBLIC_URL=http://localhost:5173
```

### 3. Run the backend

```bash
cd backend
npm run dev
```

### 4. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

The app will usually be available at `http://localhost:5173`.

## Deployment

This project is intended to be deployed on Vercel in two separate projects:

- `frontend` as the public UI
- `backend` as the API

See [`VERCEL_DEPLOYMENT.md`](./VERCEL_DEPLOYMENT.md) for the deployment steps and environment variables.

## API Endpoints

### `GET /health`

Returns backend health, model configuration, and MCP status.

### `GET /api/tools`

Lists available Kapruka MCP tools.

### `POST /api/chat`

Main chat endpoint. Accepts messages and shopper context, then returns assistant text plus any tool results or products.

### `POST /api/checkout`

Creates a guest checkout request from cart and recipient details.

### `POST /api/track`

Tracks an order using an order number.

### `POST /api/delivery-check`

Checks delivery availability for a city, date, and optional product.

### `POST /api/mcp/:toolName`

Direct wrapper for selected Kapruka MCP tools.

## Environment Variables

### Backend

- `PORT`
- `KAPRUKA_MCP_URL`
- `MODEL_PROVIDER`
- `NVIDIA_API_KEY`
- `NVIDIA_BASE_URL`
- `NVIDIA_MODEL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `MODEL_MAX_TOKENS`
- `MODEL_TEMPERATURE`
- `MODEL_TOP_P`
- `APP_PUBLIC_URL`
- `CORS_ORIGIN`

### Frontend

- `VITE_API_BASE_URL`

## Notes For Reviewers

- The frontend is intentionally kept static so it can be hosted on Vercel or another static platform.
- The backend is Node-based because it needs to call Kapruka MCP and model APIs securely.
- If the backend does not have a model API key, it falls back to deterministic behavior for core shopping tasks.
- Sensitive values are not committed. Use `.env` files locally and Vercel environment variables in production.

## Current Status

The project is already structured for GitHub + Vercel deployment and includes:

- a deployment guide
- frontend SPA routing support
- environment variable examples

## License

No license has been specified yet.
