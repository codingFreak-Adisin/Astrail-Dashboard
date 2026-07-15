import Image from "next/image";
import { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  title: string;
  description?: ReactNode;
};

export function AuthLogo({ inverse = true, className = "h-12 w-12" }: { inverse?: boolean; className?: string }) {
  return (
    <Image
      src={inverse ? "/brand/astrail-mark-inverse.svg" : "/brand/astrail-mark.svg"}
      alt="Astrail"
      width={512}
      height={512}
      priority
      className={className}
    />
  );
}

export function AuthShell({ children, title, description }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-black px-4 py-10 text-white">
      <section className="w-full max-w-[500px]">
        <div className="flex justify-center">
          <AuthLogo inverse />
        </div>
        <h1 className="mt-4 text-center text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mx-auto mt-3 max-w-md text-center text-sm leading-6 text-white/55">{description}</p>
        ) : null}
        <div className="mt-7 bg-[#191919] px-7 py-8 sm:px-12 sm:py-12">
          {children}
        </div>
      </section>
    </main>
  );
}
