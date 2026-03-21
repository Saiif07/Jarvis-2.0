# Features

Sanna is an open-source voice-first AI assistant for Android that can actually control your phone.

This document gives a more complete overview of Sanna’s capabilities beyond the main [README](./README.md).

## Core concept

Sanna is built around an LLM agent loop:

1. You speak or type a request
2. Sanna interprets the intent
3. The LLM decides which tools to use
4. Tools are called
5. Results are fed back into the loop
6. Sanna continues until the task is complete

This allows Sanna to handle multi-step requests instead of only returning one-shot answers.

---

## Voice-first interaction

Sanna is designed to be used primarily through voice.

### Includes

- Wake word activation
- Speech-to-Text input
- LLM reasoning and tool execution
- Text-to-Speech output
- Hands-free interaction flow

### Why it matters

Most assistants stop at simple commands or question answering. Sanna is designed to support real device actions through natural voice requests.

---

## Multi-step agent execution

Sanna can chain several actions together in a single request.

### Examples

- Read the last 3 emails, summarize them, and text the summary to someone
- Check tomorrow’s calendar and send the summary via SMS
- Read a shopping list and create tasks from it

### What this enables

- Tool orchestration
- Intermediate reasoning
- Task completion instead of single response generation

---

## Android app control via Accessibility

One of Sanna’s strongest differentiators is that it can operate third-party Android apps through Accessibility Services.

### Capabilities

- Read the current UI tree
- Find buttons and text fields
- Tap UI elements
- Enter text
- Navigate app flows

### Why this matters

This makes it possible to automate apps that do not expose public APIs.

### Example use cases

- Send a WhatsApp message
- Open Instagram and like a post
- Navigate through another app’s UI to complete a task

---

## Learning accessibility automation

Sanna does not treat every UI automation attempt as isolated.

After each accessibility run:

1. The full interaction history is analyzed
2. Successful and failed flows are summarized
3. App-specific hints are stored
4. These hints are injected into future runs for the same app

### Result

Repeated tasks in the same app can become faster and more reliable over time.

---

## Scheduler sub-agents

Sanna includes an autonomous scheduler for background execution.

### What it can do

- Create one-time reminders
- Run recurring tasks
- Trigger LLM-powered actions at a specific time
- Execute tasks without user interaction at runtime

### Example requests

- “Remind me in 10 minutes about the pizza”
- “Every morning at 8, read me today’s calendar”
- “Every Monday at 9, brief me on my emails”

### Important detail

These are not simple cron jobs. Each scheduled task runs as an independent LLM sub-agent with tool access.

---

## Notification-triggered sub-agents

Sanna can respond to incoming notifications using rules.

### Supported behavior

- Read notifications aloud
- Trigger actions on specific apps
- Auto-reply under certain conditions
- Evaluate rules semantically using the LLM

### Example rules

- Read all WhatsApp messages aloud
- Read full emails only when they are from your boss
- Play an alarm when an urgent Slack message arrives
- Auto-reply to a partner while driving

### Why this matters

Notification handling becomes contextual and programmable instead of static and rule-only.

---

## Driving mode

Driving mode is optimized for hands-free mobile use.

### Features

- Voice-only interaction
- Short spoken responses
- Auto-read incoming notifications
- Navigation by voice
- Hands-free calls and messaging
- Music playback control
- Volume adjustment
- Calendar access by voice
- Weather requests by voice
- Screen stays on while active

### Goal

Reduce distraction and make Sanna usable as a mobile co-pilot.

---

## Personal memory

Sanna can store structured personal memory on-device.

### Examples of remembered information

- Family members
- Job details
- Home information
- Hobbies
- Birthdays
- Anniversaries
- Important personal facts
- Long-term preferences

### How it works

When relevant details are mentioned, Sanna can write them into structured memory. This memory is then injected into future prompts to improve context awareness.

### Important note

Memory is curated and condensed over time to reduce duplication.

---

## Persona system (SOUL)

Sanna supports a customizable assistant personality called **SOUL**.

### You can define

- Tone
- Style
- Character
- General interaction behavior

### Benefits

- More personal interactions
- Flexible assistant presentation
- Persistent customization across reinstalls

---

## Markdown skills

Sanna can be extended through `SKILL.md` files.

### Why this matters

New capabilities can be added without changing app code.

### Two ways to add skills

1. Upload a Markdown skill file at runtime
2. Bundle a skill at build time

### Benefit

This makes Sanna extensible without forcing every feature into the core app.

---

## Built-in capabilities

### Communication

- Gmail
- Slack
- WhatsApp
- SMS
- Phone calls
- Contacts

### Organization

- Google Calendar
- Google Tasks
- Local lists
- Journal
- Timers
- Scheduler

### Media and information

- Spotify
- Podcasts
- Weather
- News headlines
- Web research

### Device and automation

- Notifications
- Accessibility automation
- App search
- Navigation via Google Maps

---

## Gmail

### Supports

- Read emails
- Search inbox
- Send emails
- Reply to recent messages

### Example requests

- “Read my last 3 emails”
- “Search for emails from the bank”
- “Reply to the last email: sounds good”

---

## Calendar and tasks

### Supports

- Read today’s schedule
- Check availability
- Create events
- Read and manage Google Tasks

### Example requests

- “What’s on my calendar today?”
- “Am I free at 3 PM?”
- “Add buy flowers to my tasks”

---

## Messaging and calling

### Supports

- Send WhatsApp messages
- Send SMS in the background
- Start phone calls
- Look up contacts

### Example requests

- “WhatsApp John: I’ll be there in 10 minutes”
- “Text Mom: running late”
- “Call the dentist”

---

## Lists

Lists are stored locally on-device.

### Supports

- Shopping lists
- To-do lists
- Packing lists
- Creating named lists
- Checking off items
- Removing items

### Why it matters

Useful everyday functionality without needing cloud sync or a backend.

---

## Journal

Sanna can create and manage local journal entries.

### Example use cases

- Track activities
- Save personal notes
- Organize entries by category
- Review past entries

---

## Timers

### Supports

- Countdown timers
- Stopwatches
- Acoustic alarms

### Example requests

- “Set a timer for 3 minutes”
- “Egg timer 20 seconds”
- “What timers are running?”

---

## Podcasts

### Supports

- Search for podcasts
- Subscribe to feeds
- Play latest episodes
- Resume progress
- Seek forward and backward
- Mark episodes as listened

---

## Weather and news

### Weather

- Current weather
- Forecasts
- City-based lookup
- GPS-based lookup

### Headlines

- RSS-based top headlines
- Country-specific news
- Topic-specific summaries
- Scheduled spoken briefings

---

## Music and media

### Spotify

- Search and play music
- Pause and resume
- Skip tracks
- Adjust volume

---

## Navigation

### Google Maps

- Start turn-by-turn navigation
- Open destinations from natural language input

---

## Web research

Sanna can perform web search and information retrieval using available providers.

### Use cases

- Fact lookup
- Quick research
- Answering current-information queries
- Pulling relevant info into other workflows

---

## Privacy and architecture

### Privacy-oriented design

- No backend required
- OAuth via PKCE
- Data stays on-device
- Local storage for lists, memory, and app data

### Technical stack

- React Native
- Kotlin native modules
- OpenAI or Claude as LLM provider
- Tool-based agent architecture
- Sub-agents for scheduler, notifications, and accessibility tasks

---

## Current limitations

Sanna is powerful, but it is still better suited for technical users and early adopters.

### Known friction points

- Setup may require multiple API keys
- Android permissions and integrations can be complex
- Accessibility-based automation depends on app UI stability
- Reliability can vary between apps and workflows

That is exactly why feedback, testing, and contributions matter.

---

## Related docs

- [README](./README.md)
- [DEVELOP.md](./DEVELOP.md)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
