import SectionHeading from './SectionHeading'

const steps = [
  ['01', 'Pick what to connect', 'Choose one of your Astrail servers.'],
  ['02', 'Click Download', 'You get one ready-to-use file.'],
  ['03', 'Paste into your coding agent', 'Codex, Claude, or Cursor sets it up and tests it for you.'],
]

const targets = ['TypeScript', 'Python', 'Go', 'Java', 'Kotlin', 'Ruby', 'C#', 'PHP', 'CLI', 'Docs', 'Tests', 'GitHub Actions']

export default function SdkFactory() {
  return (
    <section className="section container" id="sdk" aria-labelledby="sdk-title">
      <SectionHeading
        id="sdk-title"
        title="Connect your app in three simple steps."
        link="SDK docs"
        linkHref="/docs#sdk"
        copy="No terminal required. Download one file, copy the setup prompt, and let your coding agent do the rest."
      />

      <ol className="sdk-steps" aria-label="How to use an Astrail SDK">
        {steps.map(([number, title, description]) => (
          <li key={number}>
            <b>{number}</b>
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ol>

      <div className="sdk-panel">
        <div className="sdk-code">
          <div className="sdk-code-head">
            <span>Copy this after downloading</span>
            <span>Codex · Claude · Cursor</span>
          </div>
          <pre><code><span className="tok-str">I downloaded an Astrail SDK.</span>{`\n\n`}
Set it up in this app for me.{`\n`}
Open START_HERE.md and follow it.{`\n`}
Add one working example and test everything.{`\n`}
Keep all secrets out of the code and chat.</code></pre>
          <div className="sdk-code-head sdk-code-head--second">
            <span>Prefer doing it yourself?</span>
            <span>optional</span>
          </div>
          <pre><code><span className="tok-comment"># Run this inside the downloaded folder</span>{`\n`}
npm run quickstart</code></pre>
        </div>

        <div className="sdk-output">
          <p className="sdk-output-label">Your download includes</p>
          <div className="sdk-targets">
            {targets.map((target) => <span key={target}>{target}</span>)}
          </div>
          <div className="sdk-proof">
            <strong>No setup guessing</strong>
            <p>Every download tells your coding agent exactly what to install, where to put it, how to protect your key, and how to prove it works.</p>
          </div>
          <div className="sdk-actions">
            <a className="btn btn--dark" href="/dashboard/sdk">Download your SDK -&gt;</a>
            <a className="btn btn--ghost" href="/docs#sdk">See how it works -&gt;</a>
          </div>
        </div>
      </div>
    </section>
  )
}
