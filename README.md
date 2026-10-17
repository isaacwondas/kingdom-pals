# Kingdom Connections — Major Upgrade Starter

A React + Firebase starter for a premium, mobile-first Christian multiplayer game.

## Included
- Premium navy / teal / gold UI with CSS animations and responsive layouts
- Guest mode plus email/password registration and sign-in
- Password reset email (no custom domain required)
- Solo Bible quiz with score feedback
- Create/join Firestore multiplayer rooms
- Multiplayer Would You Rather voting
- A fixed 2 Truths & a Lie flow that shuffles statements and hides the answer until reveal
- Local demo leaderboard + shareable WhatsApp summary
- Modular file structure

## Important implementation note
This starter intentionally does **not** publish client-submitted scores into a public global leaderboard. Client-side scores can be manipulated. Before enabling a public/global leaderboard, add a trusted Cloud Function that validates completed rounds and writes leaderboard totals. The UI includes a local/session leaderboard preview and share action so the experience can be tested immediately.

## 1. Install dependencies
```bash
npm install firebase lucide-react
```

If this is a Vite React project, put these files under `src/` as laid out below. If using Next.js, place the component in a client component and adapt environment variable names to your existing setup.

## 2. Firebase setup
Create a Firebase project and enable:
- Authentication > Sign-in method > Email/Password
- Authentication > Sign-in method > Anonymous (for guest play)
- Firestore Database

No custom domain is required for password reset. Use Firebase's default action URL/email templates initially.

Create `.env.local` (Vite uses `.env` or `.env.local`) with:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Never commit real secrets or private service-account credentials. Firebase web config is public by design, but security must be enforced with Firestore Rules.

## 3. File layout
```text
src/
  lib/firebase.ts
  data/questions.ts
  services/roomService.ts
  components/KingdomConnectionsApp.tsx
  kingdom-connections.css
firestore.rules
```

Copy the files from this package into those paths.

## 4. Firestore security
Review `firestore.rules` before deploying. Rules intentionally restrict user profiles to the signed-in owner and room mutations to authenticated members/host. Real-world multiplayer rules often need to be tailored to the exact game state transitions. Do not deploy permissive `allow read, write: if true` rules.

## 5. Running it
Import the component in your app:
```tsx
import KingdomConnectionsApp from "./components/KingdomConnectionsApp";

export default function App() {
  return <KingdomConnectionsApp />;
}
```
Import the CSS in the component (already done).

## 6. Production checklist
- Configure Firebase Auth authorized domains for your current free hosting subdomain.
- Add App Check and abuse controls if needed.
- Add a trusted Cloud Function for global leaderboard scoring and room creation/host actions.
- Add rate limiting and moderation/report controls before opening public rooms.
- Test guest-to-email account linking on the target browsers.
- Set a retention policy and publish a privacy notice explaining what profile/game data is saved.
