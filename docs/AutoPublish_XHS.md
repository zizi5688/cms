# Auto Publish (XHS) – Native Electron Worker

This module runs Xiaohongshu Creator publishing inside an Electron `BrowserWindow` using partitioned sessions for per-account cookie isolation.

## Key Pieces

- `AccountManager` keeps a persistent list of XHS accounts and maps each to a `partitionKey` like `persist:xhs_<id>`.
- `PublisherService` spawns/reuses a hidden per-account worker window:
  - If not logged in, it shows the window so the user can complete QR login.
  - Once logged in, it hides the window and runs DOM automation to upload + fill + publish.
- `xhs-automation.js` is the worker window preload that performs the DOM interactions.

## Example Usage (Main Process)

```ts
import { AccountManager } from './services/accountManager'
import { PublisherService } from './services/publisher'

const accountManager = new AccountManager()
const publisher = new PublisherService(accountManager)

const account = accountManager.createAccount('Main Account')

await publisher.ensureLoggedIn(account.id)

const result = await publisher.publishTask(account.id, {
  imagePath: '/absolute/path/to/image.jpg',
  title: 'My Title',
  content: 'My Content'
})
```

## Notes

- Cookie/session isolation is enforced by setting `webPreferences.partition` for each worker window.
- The automation is intentionally heuristic (selectors/text matching) and may need updates if XHS changes UI structure.

