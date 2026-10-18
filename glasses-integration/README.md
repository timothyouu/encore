# Phone and glasses integration

This folder documents the shared phone/G2 workstream. Nothing in this folder executes or is imported by mobile.

The `g2/` host owns the bridge, microphone, gestures, and display. It mounts the phone app and shares its SessionStore, normalized recording pipeline, and History. Mobile remains free of device side effects.

## Contract and remaining device work

The implemented integration contract is in [CONTRACT.md](CONTRACT.md). Physical evidence and remaining acceptance gates are in [the verification report](../docs/physical-device-verification.md).

- Exchange validated display preferences: schemaVersion, showSheetMusicWhilePlaying, sheetMusicSize, and showNoteNames.
- Define device acknowledgement, connection/disconnection, unsupported preferences, and error reporting. A local preference save must never imply successful device application.
- Agree on transport ownership, lifecycle, gestures and microphone boundaries.
- Implement display rendering and image delivery in the glasses workstream, with physical device verification.

The mobile Settings screen currently persists preferences on the phone and renders phone previews only. It does not communicate with glasses. Earlier experimental display code is preserved in Git history at a003604, but is not part of the active implementation.
