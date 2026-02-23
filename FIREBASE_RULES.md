# Firebase Realtime Database rules (recommended)

This app uses **Anonymous Auth** (no login UI) so each browser gets a `uid`. That `uid` is used by RTDB rules to prevent players from overwriting each other.

## Enable Anonymous Auth

Firebase Console → **Authentication** → **Sign-in method** → enable **Anonymous**.

## Suggested RTDB rules

Firebase Console → Realtime Database → **Rules**:

```json
{
  "rules": {
    ".read": false,
    ".write": false,

    "rooms": {
      "$roomId": {
        ".read": true,

        // Creation: allow any signed-in (anonymous) user to create a room
        // Updates are restricted below to specific fields.
        ".write": "auth != null && !data.exists()",

        // Only room creator can change room status/startedAt
        "startedAt": {
          ".write": "auth != null && root.child('rooms/'+$roomId+'/createdBy').val() === auth.uid"
        },
        "status": {
          ".write": "auth != null && root.child('rooms/'+$roomId+'/createdBy').val() === auth.uid"
        },

        "players": {
          "p1": {
            ".write": "auth != null && (!data.exists() ? true : data.child('uid').val() === auth.uid)",
            "uid": { ".validate": "newData.isString()" },
            "name": { ".validate": "newData.isString() && newData.val().length <= 24" },
            "finished": { ".validate": "newData.isBoolean()" },
            "finishedAt": { ".validate": "newData.val() === null || newData.isNumber()" },
            "quit": { ".validate": "newData.isBoolean()" },
            "quitAt": { ".validate": "newData.val() === null || newData.isNumber()" },
            "online": { ".validate": "newData.isBoolean()" },
            "lastSeen": { ".validate": "newData.val() === null || newData.isNumber()" }
          },
          "p2": {
            ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid)",
            "uid": { ".validate": "newData.isString()" },
            "name": { ".validate": "newData.isString() && newData.val().length <= 24" },
            "finished": { ".validate": "newData.isBoolean()" },
            "finishedAt": { ".validate": "newData.val() === null || newData.isNumber()" },
            "quit": { ".validate": "newData.isBoolean()" },
            "quitAt": { ".validate": "newData.val() === null || newData.isNumber()" },
            "online": { ".validate": "newData.isBoolean()" },
            "lastSeen": { ".validate": "newData.val() === null || newData.isNumber()" }
          }
        },

        "puzzle": {
          ".validate": "newData.hasChildren(['givens','solution'])",
          "givens": { ".validate": "newData.isString() && newData.val().length === 81" },
          "solution": { ".validate": "newData.isString() && newData.val().length === 81" }
        }
      }
    }
  }
}
```

Notes:
- The Firebase Web `apiKey` is **public** by design. Security is enforced by rules + auth.
- For additional abuse protection, consider enabling **App Check**.
