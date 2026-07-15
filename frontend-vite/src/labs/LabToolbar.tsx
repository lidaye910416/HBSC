// frontend-vite/src/labs/LabToolbar.tsx
//
// Small toolbar rendered above every lab iframe. Gives the user:
//   - a back link to the labs landing page (so they never feel trapped)
//   - an "open in new window" link for the standalone lab (full-screen
//     experience with native nav/progress)
//
// Kept dead-simple — no per-lab customization. If a future lab needs
// extra controls (settings, share, etc.), add props here.
import { Link } from 'react-router-dom'

interface LabToolbarProps {
  backHref: string
  backLabel: string
  externalHref: string
  externalLabel: string
}

export function LabToolbar({ backHref, backLabel, externalHref, externalLabel }: LabToolbarProps) {
  return (
    <div className="lab-toolbar" role="toolbar" aria-label="Lab navigation">
      <Link to={backHref} className="lab-toolbar__link lab-toolbar__link--back">
        {backLabel}
      </Link>
      <a
        href={externalHref}
        target="_blank"
        rel="noopener noreferrer"
        className="lab-toolbar__link lab-toolbar__link--external"
      >
        {externalLabel}
      </a>
    </div>
  )
}
