import Image from "next/image";
import { ReactNode } from "react";

type AuthShellProps = {
  children: ReactNode;
  title: string;
  description?: ReactNode;
};

export function AuthLogo({ inverse = false, className = "h-12 w-12" }: { inverse?: boolean; className?: string }) {
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
    <main className="dash-shell flex min-h-screen items-center justify-center bg-[#f8f6f1] px-4 py-10 text-neutral-950">
      <section className="w-full max-w-[500px]">
        <div className="flex justify-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(70,45,0,0.03)]">
            <AuthLogo className="h-8 w-8" />
          </span>
        </div>
        <h1 className="mt-5 text-center text-2xl font-semibold tracking-tight text-neutral-950">{title}</h1>
        {description ? (
          <p className="mx-auto mt-2 max-w-md text-center text-sm leading-6 text-neutral-500">{description}</p>
        ) : null}
        <div className="mt-7 rounded-2xl border border-neutral-200/70 bg-white px-7 py-8 shadow-[0_1px_2px_rgba(70,45,0,0.03)] sm:px-10 sm:py-10">
          {children}
        </div>
      </section>
    </main>
  );
}
