import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'

export type Input =
  | { kind: 'tap' }
  | { kind: 'doubleTap' }
  | { kind: 'swipeUp' }
  | { kind: 'swipeDown' }
  | { kind: 'listSelect'; index: number }
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
  if (listType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'doubleTap' }
  if (listType === OsEventTypeList.CLICK_EVENT) {
    return { kind: 'listSelect', index: event.listEvent?.currentSelectItemIndex ?? 0 }
  }

  const textType = eventTypeOf(event.textEvent)
  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) return { kind: 'swipeUp' }
  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { kind: 'swipeDown' }
  if (textType === OsEventTypeList.DOUBLE_CLICK_EVENT) return { kind: 'doubleTap' }
  if (textType === OsEventTypeList.CLICK_EVENT) return { kind: 'tap' }

  const sysType = eventTypeOf(event.sysEvent)
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

export function debounced(handler: (input: Input) => void): (input: Input) => void {
  let lastKey = ''
  let lastAt = 0
  return input => {
    const key = JSON.stringify(input)
    const now = Date.now()
    if (key === lastKey && now - lastAt < DUPLICATE_WINDOW_MS) return
    lastKey = key
    lastAt = now
    handler(input)
  }
}
