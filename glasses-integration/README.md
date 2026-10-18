# Future glasses integration

This separate folder reserves the phone-to-glasses integration workstream. Device integration is deferred; nothing in this folder executes or is imported by mobile.

The existing `g2/` folder remains the glasses owner's runtime. Do not duplicate it here or connect it to `mobile/` until an integration contract is reviewed with that owner.

## Pending contract

- Exchange validated display preferences: schemaVersion, showSheetMusicWhilePlaying, sheetMusicSize, and showNoteNames.
- Define device acknowledgement, connection/disconnection, unsupported preferences, and error reporting. A local preference save must never imply successful device application.
- Agree on transport ownership, lifecycle, gestures and microphone boundaries.
- Implement display rendering and image delivery in the glasses workstream, with physical device verification.

The mobile Settings screen currently persists preferences on the phone and renders phone previews only. It does not communicate with glasses. Earlier experimental display code is preserved in Git history at a003604, but is not part of the active implementation.
