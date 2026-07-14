import { useState } from 'react'
import SectionHeading from './SectionHeading'

const clientTabs = ['OpenAI Agents SDK', 'Claude / MCP', 'Cursor']

function CodeSample() {
  return (
    <pre>
      <code>
        <span className="tok-kw">import</span> {'{ Agent, run }'} <span className="tok-kw">from</span>{' '}
        <span className="tok-str">&quot;@openai/agents&quot;</span>;{'\n'}
        <span className="tok-kw">import</span> {'{ MCPServerStreamableHttp }'}{' '}
        <span className="tok-kw">from</span> <span className="tok-str">&quot;@openai/agents&quot;</span>;{'\n\n'}
        <span className="tok-kw">const</span> <span className="tok-var">astrail</span> ={' '}
        <span className="tok-kw">new</span> <span className="tok-fn">MCPServerStreamableHttp</span>({'{'}
        {'\n'}
        {'    '}url: <span className="tok-str">&quot;https://mcp.astrail.ai/acme/ops&quot;</span>,{'\n'}
        {'    '}name: <span className="tok-str">&quot;astrail-ops&quot;</span>,{'\n'}
        {'}'});{'\n\n'}
        <span className="tok-kw">const</span> <span className="tok-var">agent</span> ={' '}
        <span className="tok-kw">new</span> <span className="tok-fn">Agent</span>({'{'}
        {'\n'}
        {'    '}name: <span className="tok-str">&quot;Ops Agent&quot;</span>,{'\n'}
        {'    '}instructions: <span className="tok-str">&quot;Use Astrail tools for purchasing.&quot;</span>,{'\n'}
        {'    '}mcpServers: [<span className="tok-var">astrail</span>],{'\n'}
        {'}'});{'\n\n'}
        <span className="tok-cm">{'// every tools/call maps to a real API request'}</span>
        {'\n'}
        <span className="tok-kw">const</span> <span className="tok-var">result</span> ={' '}
        <span className="tok-kw">await</span> <span className="tok-fn">run</span>(
        <span className="tok-var">agent</span>,{' '}
        <span className="tok-str">&quot;Create a PO for vendor #82&quot;</span>);
      </code>
    </pre>
  )
}

export default function Clients() {
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)

  return (
    <section className="section container" aria-labelledby="clients-title">
      <SectionHeading
        id="clients-title"
        title="Works with any MCP client"
        copy="One hosted endpoint, usable from every agent framework or MCP client out of the box"
      />
      <div className="code-toolbar">
        <div className="code-tabs" role="tablist" aria-label="Agent framework">
          {clientTabs.map((tab, index) => (
            <button
              key={tab}
              role="tab"
              aria-selected={active === index}
              onClick={() => setActive(index)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
        <span className="lang-chip">typescript ⌄</span>
      </div>
      <div className="code-block">
        <button
          className="code-copy"
          type="button"
          onClick={() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <CodeSample />
      </div>
    </section>
  )
}
