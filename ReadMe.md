# Eterna Labs Full Time Role Backend Assignment

Problem Statement :  Build an order execution engine that processes ONE order type (market, limit, or sniper - your choice) with DEX routing and WebSocket status updates. You can choose between real devnet execution OR mock implementation.

## 📋 Table of Contents
- [Problem Statement & Solution](#problem-statement--solution)
- [Design Decisions](#design-decisions-critical)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [API Documentation](#api-documentation)
- [Testing](#testing)
- [Deployment](#deployment)

---

## Problem Statement & Solution

**Goal:** Build a backend engine to execute trades on Solana, routing between Raydium and Meteora to find the best price, while handling high concurrency and providing live feedback.

**Solution:**
This engine uses a hybrid HTTP/WebSocket pattern. Users submit orders via HTTP (for reliability), which are offloaded to a Redis-backed queue (BullMQ). A dedicated worker process picks up orders, queries a Mock DEX Router for the best rates, executes the trade, and streams updates back to the client via WebSockets.

---

## Design Decisions (Critical)

### 1. Order Type: Market Orders
**Why I chose Market Orders:**
I focused on **Market Orders** to prioritize the architecture of high-frequency, low-latency processing. Market orders require immediate execution, which puts the most stress on the **Queue -> Worker -> Router** pipeline. This choice allowed me to demonstrate:
* Race condition handling.
* Real-time state management.
* Optimized routing logic without the overhead of maintaining long-running state (which Limit orders require).

### 2. Extensibility (Limit & Sniper Orders)
This engine was designed to be easily extended:
* **Limit Orders:** Can be implemented by adding a `target_price` column to the database. A separate "Watcher" service (or a repeated BullMQ job) would poll price feeds. When `current_price <= target_price`, the Watcher would inject the job into the existing `orders` queue, reusing the exact same execution logic present today.
* **Sniper Orders:** Similar to Limit orders, but triggered by a `liquidity_added` event on-chain. The architecture supports this by simply allowing a new "Event Listener" service to push jobs into the existing Redis queue.

### 3. Hybrid URL Parsing
To ensure stability across different deployment environments (Local vs Cloud), the WebSocket server uses a **Low-Level Native implementation**. It bypasses framework-specific routing to directly parse the URL path (`/ws/orders/:id`), ensuring 100% connection reliability.

---

## Architecture

1.  **API Server (Fastify):** Accepts POST requests, validates input, persists initial state to PostgreSQL, and pushes the job to Redis.
2.  **Message Queue (BullMQ):** Manages concurrency (limit 10) and retries (exponential backoff) to prevent network congestion.
3.  **Worker Service:**
    * Dequeues orders.
    * **Mock Router:** Queries Raydium and Meteora (simulated latency & price variance).
    * **Logic:** Compares `amountOut` and selects the best DEX.
    * **Execution:** Simulates transaction building and confirmation.
    * **Updates:** Pushes status changes to the WebSocket Manager.
4.  **WebSocket Server:** Streams real-time lifecycle events (`pending` -> `routing` -> `confirmed`) to the client.

---

## Tech Stack

* **Runtime:** Node.js + TypeScript
* **Server Framework:** Fastify (Selected for low overhead)
* **Real-time:** Native `ws` library (attached to Fastify server)
* **Queue:** BullMQ + Redis
* **Database:** PostgreSQL (Chosen for ACID compliance and relational integrity)
* **Testing:** Jest + Supertest

---

## Prerequisites

To run this locally, ensure you have:
1.  **Node.js** (v18 or higher)
2.  **PostgreSQL** (Running locally or via a cloud provider like Neon/Supabase)
3.  **Redis** (Running locally or via a cloud provider like Upstash)

---

## Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd backend-eternal-lab
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Configure Environment:**
    Create a `.env` file in the root directory:
    ```ini
    PORT=3000
    # Update user/password/db_name
    PG_CONNECTION=postgresql://postgres:password@localhost:5432/postgres
    REDIS_URL=redis://127.0.0.1:6379
    QUEUE_PREFIX=order-engine
    WORKER_CONCURRENCY=10
    ```

4.  **Run the Application:**
    ```bash
    # Runs in development mode (with hot-reload)
    npm run dev
    ```
    *Note: The application will automatically create the necessary Database Tables on startup.*

---

## API Documentation

### 1. Submit Order
* **Endpoint:** `POST /api/orders/execute`
* **Body:**
    ```json
    {
      "tokenIn": "SOL",
      "tokenOut": "USDC",
      "amountIn": 1.5
    }
    ```
* **Response (202 Accepted):**
    ```json
    {
      "orderId": "a1b2c3d4-...",
      "status": "queued",
      "wsUrl": "ws://localhost:3000/ws/orders/a1b2c3d4-..."
    }
    ```

### 2. Live Updates (WebSocket)
* **URL:** `ws://localhost:3000/ws/orders/:orderId`
* **Lifecycle Events:**
    1.  `connected`
    2.  `pending` (Worker picked up job)
    3.  `routing` (Comparing DEX prices)
    4.  `building` (Wrapping SOL, creating Tx)
    5.  `submitted` (Sent to network)
    6.  `confirmed` (Includes `txHash` and `executedPrice`)

---

## Testing

The project includes a comprehensive integration test suite using Jest. It tests the full flow from HTTP API to WebSocket confirmation.

```bash
# Run the test suite (Requires App to be running)
npm test

# Deployment Guide (Render.com)

This guide details how to deploy the Order Execution Engine to **Render.com** using their free tier for Node.js, PostgreSQL, and Redis.

## Prerequisites
* A GitHub account with this repository pushed.
* A [Render.com](https://render.com/) account.

---

## Step 1: Create the Databases
You must create the database services first to generate the connection strings needed for the application.

### 1. PostgreSQL Database
1. Log in to the Render Dashboard.
2. Click **New +** and select **PostgreSQL**.
3. **Name:** `order-db`
4. **Region:** Choose the region closest to you (e.g., Singapore, Frankfurt).
5. **Plan:** Free.
6. Click **Create Database**.
7. **Copy Connection:** Scroll down to the **Connections** section. Copy the **"Internal Database URL"** (starts with `postgres://`). Save this for Step 3.

### 2. Redis Database
1. Click **New +** and select **Redis**.
2. **Name:** `order-queue`
3. **Region:** **Must match the region you chose for PostgreSQL.**
4. **Plan:** Free.
5. Click **Create Redis**.
6. **Copy Connection:** Scroll down to the **Connections** section. Copy the **"Internal Redis URL"** (starts with `redis://`). Save this for Step 3.

---

## Step 2: Deploy the Node.js Web Service

1. Click **New +** and select **Web Service**.
2. Click **Build and deploy from a Git repository**.
3. Connect your GitHub account and select the `backend-eternal-lab` repository.
4. Configure the following settings exactly:

| Setting | Value |
| :--- | :--- |
| **Name** | `order-engine` |
| **Region** | Same as your databases |
| **Runtime** | `Node` |
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `npm run start` |
| **Plan** | Free |

---

## Step 3: Configure Environment Variables

Before clicking "Create", scroll down to the **Environment Variables** section. Click "Add Environment Variable" for each of the following:

| Key | Value |
| :--- | :--- |
| `PG_CONNECTION` | Paste the **Internal Database URL** copied in Step 1. |
| `REDIS_URL` | Paste the **Internal Redis URL** copied in Step 1. |
| `QUEUE_PREFIX` | `order-engine` |
| `WORKER_CONCURRENCY` | `10` |
| `NODE_VERSION` | `18` |

*Note: You do not need to add a `PORT` variable; Render sets this automatically to 10000.*

---

## Step 4: Finish & Verify

1. Click **Create Web Service**.
2. Render will start the build process. This typically takes 2-4 minutes.
3. Click on the **Logs** tab to monitor progress.

**Success Indicators:**
You know the deployment is successful when you see logs similar to:
* `Running 'npm run build'`
* `Build successful`
* `[WORKER] Redis Config: redis://red-.......`
* `Server listening on http://0.0.0.0:10000`

### Your Public URL
Your API is now accessible at the URL shown in the top-left corner of the dashboard (e.g., `https://order-engine.onrender.com`).

---

## Troubleshooting Common Errors

**Error: `Cannot find module .../index.js`**
* **Cause:** Render is trying to guess your start command.
* **Fix:** Ensure the **Start Command** in Settings is explicitly set to `npm run start`.

**Error: `connect ECONNREFUSED 127.0.0.1...`**
* **Cause:** The application cannot find the environment variables and is defaulting to localhost.
* **Fix:** Go to the **Environment** tab and double-check that `PG_CONNECTION` and `REDIS_URL` are pasted correctly and do not contain spaces.
