import type { Glasses } from './glasses'
import { status } from './status'
import { isValidUploadUrl, saveUploadUrl } from './upload'

// Phone-side configuration for the glasses app: where finished takes are
// uploaded. Saved in Even app storage so it survives restarts.
export function mountUploadSettings(glasses: Glasses, initial: string, onChange: (url: string) => void) {
  const root = document.getElementById('settings')
  if (!root) return

  root.innerHTML = `
    <label for="upload-url">Upload URL</label>
    <div class="row">
      <input id="upload-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off"
        spellcheck="false" placeholder="https://your-api.example/v1/recordings" />
      <button id="upload-save" type="button">Save</button>
    </div>`

  const input = root.querySelector<HTMLInputElement>('#upload-url')!
  const button = root.querySelector<HTMLButtonElement>('#upload-save')!
  input.value = initial
  if (!initial) status('no upload URL set; takes will not be uploaded')

  button.addEventListener('click', async () => {
    const url = input.value.trim()
    if (url && !isValidUploadUrl(url)) {
      status(`not a valid URL: ${url}`, 'error')
      return
    }
    const ok = await saveUploadUrl(glasses, url).catch(() => false)
    if (!ok) {
      status('could not save upload URL', 'error')
      return
    }
    onChange(url)
    status(url ? `upload URL saved: ${url}` : 'upload URL cleared')
  })
}
