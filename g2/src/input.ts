import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

export type Input =
  | { kind: 'tap' }
  | { kind: 'doubleTap' }
  | { kind: 'swipeUp' }
  | { kind: 'swipeDown' }
  | { kind: 'listSelect'; index: number }
  | { kind: 'longPress' }
  | { kind: 'longPressRelease' }
  | { kind: 'foreground' }
  | { kind: 'exit' }

// CLICK_EVENT is 0 and protobuf omits zero values, so a tap arrives with
// `eventType` undefined. Resolve the default inside the envelope check;
// defaulting outside would read CLICK on events that carry no envelope.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

export function toInput(event: EvenHubEvent): Input | null {
  const listType = eventTypeOf(event.listEvent)
  const textType = eventTypeOf(event.textEvent)
  const sysType = eventTypeOf(event.sysEvent)

  // Long presses are documented on sysEvent, but accept them from any envelope.
  const types = [listType, textType, sysType]
  if (types.includes(OsEventTypeList.LONG_PRESS_EVENT)) return { kind: 'longPress' }
  if (types.includes(OsEventTypeList.LONG_PRESS_RELEASE_EVENT)) return { kind: 'longPressRelease' }

  if (listType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'doubleTap' }
  if (listType === OsEventTypeList.CLICK_EVENT) {
    return { kind: 'listSelect', index: event.listEvent?.currentSelectItemIndex ?? 0 }
  }

  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) return { kind: 'swipeUp' }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { kind: 'swipeDown' }
  if (textType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'doubleTap' }
  if (textType === OsEventTypeList.CLICK_EVENT) return { kind: 'tap' }

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'doubleTap' }
  if (sysType === OsEventTypeList.CLICK_EVENT) return { kind: 'tap' }
  if (sysType === OsEventTypeList.FOREGROUND_ENTER_EVENT) return { kind: 'foreground' }
  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    return { kind: 'exit' }
  }
  return null
}

// Hardware can report one gesture twice in quick succession; drop the repeat.
const DUPLICATE_WINDOW_MS = 250
// A tap or list click that arrives while a long press is held, or just after
// it is released, belongs to that long press. Letting it through could start
// or stop a recording (spec §4 controls).
const AFTER_RELEASE_MS = 400
// If the release event is lost, stop treating the press as held after this.
const MAX_HOLD_MS = 4000

export function filterInputs(handler: (input: Input) => void): (input: Input) => void {
  let lastKey = ''
  let lastAt = 0
  let pressedAt = -Infinity
  let releasedAt = -Infinity

  return input => {
    const now = Date.now()

    if (input.kind === 'longPressRelease') {
      pressedAt = -Infinity
      releasedAt = now
      return
    }
    if (input.kind === 'longPress') pressedAt = now
    const held = now - pressedAt < MAX_HOLD_MS
    if ((input.kind === 'tap' || input.kind === 'listSelect') && (held || now - releasedAt < AFTER_RELEASE_MS)) {
      return
    }

    const key = JSON.stringify(input)
    if (key === lastKey && now - lastAt < DUPLICATE_WINDOW_MS) return
    lastKey = key
    lastAt = now
    handler(input)
  }
}
