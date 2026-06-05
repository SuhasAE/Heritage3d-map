Heritage Map — India's Living Heritage

Interactive web app to explore India’s heritage sites with an AI assistant (Dora).

Overview
Displays heritage sites on an interactive MapLibre GL map with search, filters, and AI-based contextual info.

Workflow

Map loads India with categorized heritage markers
Users search/filter and click sites to view details in a sidebar
Dora AI answers questions using site context via Cloudflare Worker + Groq (llama-3.3-70b-versatile)
Users can select sites and generate travel routes with animated navigation

Tech Stack
MapLibre GL, Vanilla HTML/CSS, Cloudflare Workers, Groq API, Google Fonts

Setup

Deploy worker via wrangler
Add GROQ_API_KEY as secret
Update worker URL in frontend
Open index.html
