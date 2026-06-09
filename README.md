# Universal Shopping Bot

A high-performance, modular shopping bot built with Node.js, Playwright, and an elegant glassmorphism Web Dashboard. 

Originally created to hunt for fast-selling items (like TCG boosters) on specific stores. Currently highly optimized for Rebel.pl with checkout speeds around 10 seconds.

## Features

- Web Dashboard: Beautiful, real-time UI to manage tasks, monitor logs, and check stats.
- Ultra-Fast Checkout: Skips unnecessary steps, uses direct API requests where possible, and aggressively interacts with DOM elements to finalize orders in record time.
- Buying Profiles: Create multiple delivery/billing profiles (e.g. different InPost lockers) and assign them to specific tasks.
- Turbo Mode (Drop Scheduler): Set a specific drop time. The bot will automatically accelerate its polling interval (e.g. to 5 seconds) right before the drop hits.
- Discord & Sound Alerts: Get instant notifications via Discord Webhooks and a loud alarm in the browser when a product is snagged.
- Headless & Test Modes: Run the bot completely in the background, or use Test Mode to simulate the entire checkout process and stop exactly one click before the final payment.

## Tech Stack

- Backend: Node.js, Express.js, Playwright
- Frontend: Vanilla JS, HTML5, CSS3 (Custom Glassmorphism UI)
- Database: Local JSON file (db.json)

## How to use

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the bot manager (starts the backend and dashboard):
   ```bash
   node server.js & node botManager.js
   ```
4. Open your browser and go to http://localhost:3000.
5. Create a Buying Profile, add a product link, click "Start" and let the bot do the rest!

## Note on Security

All your personal data, addresses, and passwords are saved locally in db.json. This file is gitignored to ensure you never accidentally push your private details to a public repository.

## Extending

The bot uses a modular architecture. Support for new stores can be added by creating a new driver in the sites/ folder and hooking it up to the botManager.js logic.
