# 🙈 Hide-and-Seek: Smart Campus Lost & Found

*Things aren't lost, they're just hiding. We help you seek them.*

Students report lost and found items. The system **automatically compares every new report against older ones** and shows a **matching probability (%)**. The owner claims the item by answering the finder's secret question, then the two arrange a handover through a **masked chat** and a **safe on-campus meetup**. No phone numbers are shared.

Built for the **Rubix 2026 Mini Hackathon**, Problem Statement 1: Smart Lost and Found.

## Flow

1. **Campus login**: sign up with name, unique **username**, campus email (.edu / .ac.in) and password; log in with username or email
2. **Report submission**: item name, description, tags, category, colour, location, date/time and a photo. Status: **Active**
3. **Automated matching**: new reports are compared with old reports on keywords, tags, location, timestamps, colour and photo, giving a matching %
4. **User verification**: "This is my item" / "Not my item". The owner answers the finder's secret question (or the finder reviews the claim by hand). Status: **Matched**
5. **Masked chat**: phone numbers, emails and social handles are hidden automatically
6. **Safe meetup**: propose and accept a staffed campus spot and time
7. **Handover**: either side marks it done. Status: **Resolved**

Also: **add / edit / delete** your own reports, a "My reports" dashboard, notifications (new matches, claims to review, new messages), search and filters, a purple & white theme, and a phone-friendly layout.

## How matching works

| Signal | Method | Weight (no photos / with photos) |
|---|---|---|
| Keywords & tags | TF-IDF cosine similarity, synonym merging (earbuds = airpods = earphones) | 30% / 25% |
| Category | Exact = 1, related (wallet ↔ ID card) = partial | 20% / 15% |
| Location | Distance between places on the campus map | 15% / 15% |
| Time | Found soon after lost = high; fades over ~5 days; found *before* lost = 0 | 15% / 10% |
| Colour | Same = 1, similar shade = 0.5 | 10% / 10% |
| Photo | MobileNet image embeddings (cosine) + colour histogram | — / 25% |

Missing signals are skipped and the weights re-balanced. If neither the keywords nor the photo agree, the score is halved, so place and time alone can't create a match. Pairs below 40% are hidden.

## Tech stack

- **HTML, CSS, JavaScript**: no framework and no build step
- **TensorFlow.js + MobileNet v2**: in-browser image recognition, auto-tagging and photo similarity
- **Firebase Cloud Firestore**: shared online database, so everyone on every device sees the same reports and chats, updated live
- **localStorage**: automatic fallback when no database is configured (data stays on one device)
- Hosted on **GitHub Pages**

## Project structure

```
index.html        page layout
css/style.css     dark theme styling
js/data.js        campus places, safe spots, icons, users, storage
cloud.js       shared online database (Firebase Firestore) sync
js/matcher.js     matching algorithm + answer verification
js/image.js       photo resizing, colour detection, AI model
js/app.js         pages, login, forms, chat, add/edit/delete
```

## Run it

Open `index.html` in a browser, or visit the live site. Create an account with your campus email and start reporting.

## Turn on the shared database (so many people can use it)

1. Go to https://console.firebase.google.com and click **Create a project** (call it `hide-and-seek`; you can turn Google Analytics off).
2. In the project, click the **</>** (Web) icon, give the app a nickname, and click **Register app**. Copy the `firebaseConfig = { ... }` block it shows.
3. Left menu: **Build → Firestore Database → Create database**. Pick a location near you and choose **Start in test mode**.
4. Open `cloud.js`, replace `const FIREBASE_CONFIG = null;` with `const FIREBASE_CONFIG = { ...what you copied... };` and upload it to GitHub again.

When it's working, the **How it works** page shows *Data: shared online database*.

## Future scope

- Firebase Authentication / college SSO instead of app-managed passwords, plus locked-down database security rules
- Automated email alerts for new matches
- QR-code stickers on belongings that link to the owner
- Integration with the campus security desk / lost-property office
- Sentence-embedding models for better text understanding
