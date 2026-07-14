import { useState } from 'react'
import SectionHeading from './SectionHeading'

const plans = [
  {
    name: 'Free',
    monthly: '$0',
    yearly: '$0',
    description: 'Great for small teams getting started.',
    features: ['50 MCP generations / month', '1 hosted endpoint', '1,000 tool calls'],
    cta: 'Start free',
  },
  {
    name: 'Growth',
    monthly: '$20',
    yearly: '$15',
    description: 'For fast-growing teams who are scaling.',
    features: ['200 MCP generations', '5 hosted endpoints', '50,000 tool calls'],
    cta: 'Choose Growth',
    highlight: true,
  },
  {
    name: 'Premium',
    monthly: '$99–$199',
    yearly: '$79–$179',
    description: 'Great for enterprises that need scale.',
    features: [
      'Fair-use MCP generations & endpoints',
      '500k–1M tool calls',
      'Dedicated account manager',
    ],
    cta: 'Talk to us',
  },
]

export default function Pricing() {
  const [yearly, setYearly] = useState(false)

  return (
    <section className="section container" id="pricing" aria-labelledby="pricing-title">
      <SectionHeading
        id="pricing-title"
        title="Pricing"
        link="Pricing details"
        linkHref="#pricing"
        copy="Start free, scale when your agents do. Every plan includes hosted execution, logs, and exportable code"
      />
      <div className="billing" role="group" aria-label="Billing frequency">
        <button className={!yearly ? 'active' : ''} type="button" onClick={() => setYearly(false)}>
          Monthly
        </button>
        <button className={yearly ? 'active' : ''} type="button" onClick={() => setYearly(true)}>
          Yearly
        </button>
      </div>
      <div className="plans">
        {plans.map((plan) => (
          <article className={`plan ${plan.highlight ? 'plan--hl' : ''}`} key={plan.name}>
            <div className="plan-name">
              {plan.name}
              {plan.highlight && <span>MOST POPULAR</span>}
            </div>
            <div className="plan-price">
              {yearly ? plan.yearly : plan.monthly}
              {plan.name !== 'Free' && <small> / month</small>}
            </div>
            <p className="plan-desc">{plan.description}</p>
            <a className={`btn ${plan.highlight ? 'btn--dark' : 'btn--ghost'}`} href="/signup">
              {plan.cta} -&gt;
            </a>
            <div className="plan-feats">
              {plan.features.map((feature) => (
                <div key={feature}>
                  <b>✓</b>
                  {feature}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
      <p className="table-note">Yearly prices billed annually. Tool-call limits reset monthly.</p>
    </section>
  )
}
