import examples from '../../shared/visual-examples.json'
import type { VisualPlan } from '../../shared/visual-contract.ts'
import { validateVisualPlan } from '../../shared/visual-plan.ts'
import { mountPaperVisualization, type PaperVisualization } from './paper-renderer.ts'
import './paper-renderer.css'

interface Example { name: string; plan: VisualPlan }
const collection = examples as { schemaVersion: string; examples: Example[] }

function button(label: string, type = 'button'): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = type as 'button'
  element.textContent = label
  return element
}

export function mountPaperGallery(host: HTMLElement): () => void {
  host.classList.add('paper-gallery')
  const title = document.createElement('h1')
  title.textContent = 'Paper visualization gallery'
  const intro = document.createElement('p')
  intro.textContent = '576 × 288 visual studies. Later phrase cards use fixture data only.'
  const layout = document.createElement('div')
  layout.className = 'paper-gallery-layout'
  const controls = document.createElement('section')
  controls.className = 'paper-gallery-controls'
  const stage = document.createElement('section')
  stage.className = 'paper-gallery-stage'
  const selectLabel = document.createElement('label')
  selectLabel.textContent = 'Paper example'
  const preset = document.createElement('select')
  for (const [index, example] of collection.examples.entries()) {
    const option = document.createElement('option')
    option.value = String(index)
    option.textContent = example.name
    preset.append(option)
  }
  selectLabel.append(preset)
  const cardLabel = document.createElement('label')
  cardLabel.textContent = 'Card'
  const cardPicker = document.createElement('select')
  cardLabel.append(cardPicker)
  const motionLabel = document.createElement('label')
  motionLabel.className = 'paper-gallery-motion'
  const reducedCheckbox = document.createElement('input')
  reducedCheckbox.type = 'checkbox'
  reducedCheckbox.checked = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  motionLabel.append(reducedCheckbox, document.createTextNode(' Reduced motion'))
  const replayButton = button('↻ Replay')
  const applyButton = button('Apply JSON')
  const jsonLabel = document.createElement('label')
  jsonLabel.textContent = 'VisualPlan JSON'
  const input = document.createElement('textarea')
  input.spellcheck = false
  input.setAttribute('aria-label', 'VisualPlan JSON')
  jsonLabel.append(input)
  const status = document.createElement('p')
  status.className = 'paper-gallery-status'
  status.setAttribute('role', 'status')
  const visualHost = document.createElement('div')
  visualHost.className = 'paper-gallery-visual-host'
  const caption = document.createElement('p')
  caption.className = 'paper-gallery-caption'
  controls.append(selectLabel, cardLabel, motionLabel, replayButton, jsonLabel, applyButton, status)
  stage.append(visualHost, caption)
  layout.append(controls, stage)
  host.replaceChildren(title, intro, layout)

  let plan: VisualPlan = collection.examples[0].plan
  let visual: PaperVisualization | undefined
  let currentIndex = 0
  let disposed = false
  function syncCards(): void {
    const before = cardPicker.value
    cardPicker.replaceChildren()
    plan.cards.forEach((card, index) => {
      const option = document.createElement('option')
      option.value = String(index)
      option.textContent = card.kind.replaceAll('_', ' ') + ' · ' + card.variant
      cardPicker.append(option)
    })
    cardPicker.value = before && Number(before) < plan.cards.length ? before : '0'
  }
  function render(): void {
    visual?.destroy()
    visualHost.replaceChildren()
    const card = plan.cards[Number(cardPicker.value) || 0]
    if (!card) { caption.textContent = 'This plan has no cards.'; return }
    visual = mountPaperVisualization(card, { reducedMotion: reducedCheckbox.checked })
    visualHost.append(visual.element)
    const fixture = card.evidence.source === 'fixture'
    caption.textContent = (fixture ? 'Fixture only · ' : 'Analysis · ') +
      card.kind.replaceAll('_', ' ') + ' · ' + card.variant +
      '. Expected: ' + card.expected.label + '. Detected: ' + card.detected.label + '.'
  }
  function usePlan(candidate: unknown): void {
    if (!validateVisualPlan(candidate)) {
      status.textContent = 'Invalid VisualPlan JSON. Check the schema, kind, and evidence fields.'
      status.dataset.state = 'error'
      return
    }
    plan = candidate
    currentIndex = -1
    status.textContent = 'Validated VisualPlan.'
    status.dataset.state = 'ok'
    syncCards()
    render()
  }
  function onPreset(): void {
    currentIndex = Number(preset.value)
    const example = collection.examples[currentIndex]
    if (!example) return
    input.value = JSON.stringify(example.plan, null, 2)
    usePlan(example.plan)
    currentIndex = Number(preset.value)
    status.textContent = example.name + ' · validated fixture'
  }
  function onApply(): void {
    try { usePlan(JSON.parse(input.value)) }
    catch { status.textContent = 'JSON syntax error.'; status.dataset.state = 'error' }
  }
  function onReplay(): void { visual?.replay() }
  function onMotion(): void { render() }
  function onCard(): void { render() }
  preset.addEventListener('change', onPreset)
  cardPicker.addEventListener('change', onCard)
  reducedCheckbox.addEventListener('change', onMotion)
  replayButton.addEventListener('click', onReplay)
  applyButton.addEventListener('click', onApply)
  onPreset()
  return (): void => {
    if (disposed) return
    disposed = true
    visual?.destroy()
    preset.removeEventListener('change', onPreset)
    cardPicker.removeEventListener('change', onCard)
    reducedCheckbox.removeEventListener('change', onMotion)
    replayButton.removeEventListener('click', onReplay)
    applyButton.removeEventListener('click', onApply)
    host.replaceChildren()
  }
}

const host = document.getElementById('paper-gallery')
if (host) mountPaperGallery(host)

