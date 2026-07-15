import Image from 'next/image'

export default function Logo() {
  return (
    <a className="brand" href="#top" aria-label="Astrail home">
      <Image
        src="/brand/astrail-mark.svg"
        alt=""
        width={512}
        height={512}
        className="brand-mark"
        priority
      />
      <span className="brand-name">Astrail</span>
    </a>
  )
}
