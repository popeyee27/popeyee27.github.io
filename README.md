# bcyu.dev - Personal Workspace

Welcome to my personal developer workspace and portfolio, hosted at [bcyu.dev](https://bcyu.dev). 
This repository contains the source code for my landing page and various web projects.

## Projects

### 🌧️ Romklao 24 Weather
A real-time water level monitoring and weather radar system for the Romklao 24 area.
- **URL**: [https://bcyu.dev/hydoreus/](https://bcyu.dev/hydoreus/)
- **Tech Stack**: HTML, Tailwind CSS, JavaScript (Vanilla), Python (Scraper), Cloudflare R2
- **Features**: 
  - Real-time water levels from BMA API.
  - Weather forecast from TMD.
  - Interactive charts and radar images.
  - Fully serverless frontend with Cloudflare R2 acting as the data CDN.

## Architecture
- **Frontend**: Pure HTML/JS/CSS served via GitHub Pages.
- **Backend/Data**: A lightweight Python scraper running on a local home server pushes `.csv` and `.json` data directly to Cloudflare R2 via AWS CLI.
- **Edge Security**: Cloudflare acts as a proxy, enforcing SSL, handling DNS, and providing CDN caching (Cache Rules) to absorb heavy traffic and protect the R2 bucket.

---
*Created by BcYU*
