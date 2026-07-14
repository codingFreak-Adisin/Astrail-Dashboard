import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { AstrailLogo } from "@/components/AstrailLogo";
import { ServerCard } from "@/components/ServerCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { presetServers } from "@/lib/preset-servers";
import type { McpServer } from "@/lib/types";

function marketplaceCategory(server: McpServer) {
  return server.category ?? (server.source_type === "preset" ? "Template" : "Generated");
}

function categoryHref(category: string, search: string) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (category !== "All") params.set("category", category);
  const query = params.toString();
  return query ? `/marketplace?${query}` : "/marketplace";
}

export default async function MarketplacePage({ searchParams }: { searchParams?: { search?: string; category?: string } }) {
  const search = searchParams?.search?.trim().toLowerCase() ?? "";
  const selectedCategory = searchParams?.category?.trim() || "All";
  const allServers = presetServers;
  const categories = ["All", ...Array.from(new Set(allServers.map(marketplaceCategory))).sort((a, b) => a.localeCompare(b))];
  const servers = allServers.filter((server) => {
    const category = marketplaceCategory(server);
    const categoryMatches = selectedCategory === "All" || category === selectedCategory;
    if (!categoryMatches) return false;
    if (!search) return true;
    const toolText = JSON.stringify(server.tools_json ?? []).toLowerCase();
    return (
      server.name.toLowerCase().includes(search) ||
      category.toLowerCase().includes(search) ||
      (server.description ?? "").toLowerCase().includes(search) ||
      toolText.includes(search)
    );
  });
  const showFeatured = selectedCategory === "All" && !search;
  const featuredPresets = presetServers.slice(0, 5);
  const galleryServers = showFeatured
    ? servers.filter((server) => !featuredPresets.some((preset) => preset.id === server.id))
    : servers;
  const topCategories = categories.filter((category) => category !== "All").slice(0, 8);

  return (
    <main className="min-h-screen bg-[#f7f7f5]">
      <header className="border-b border-neutral-200 bg-[#f7f7f5] px-4 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-neutral-300 bg-white px-3 font-mono text-[13px] font-semibold uppercase text-neutral-950 shadow-sm transition hover:border-orange-300 hover:text-orange-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
          <div className="h-8 w-px bg-neutral-200" />
          <AstrailLogo markClassName="h-8 w-8" labelClassName="text-[26px] font-black" />
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8">
        <section className="border-b pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Catalog</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-neutral-950">Marketplace</h1>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                Install curated MCP templates, then connect credentials when your agent is ready to act.
              </p>
            </div>
            <form className="w-full lg:max-w-xl">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                <Input
                  name="search"
                  defaultValue={searchParams?.search ?? ""}
                  placeholder="Search GitHub, Stripe, Slack, docs, payments..."
                  className="h-11 rounded-lg border-neutral-300 bg-white pl-10 text-sm shadow-sm"
                />
                {selectedCategory !== "All" && <input type="hidden" name="category" value={selectedCategory} />}
              </div>
            </form>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {["All", ...topCategories].map((category) => (
              <Button
                key={category}
                asChild
                variant={category === selectedCategory ? "default" : "outline"}
                size="sm"
                className={category === selectedCategory ? "bg-orange-600 hover:bg-orange-700" : "bg-white"}
              >
                <Link href={categoryHref(category, searchParams?.search ?? "")}>{category}</Link>
              </Button>
            ))}
          </div>
        </section>

        <div className="mt-6 flex flex-wrap gap-2">
          {categories.slice(9).map((category) => (
            <Link
              key={category}
              href={categoryHref(category, searchParams?.search ?? "")}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition hover:border-orange-300 hover:text-orange-700 ${
                category === selectedCategory ? "border-orange-500 bg-orange-50 text-orange-700" : "bg-white text-neutral-700"
              }`}
            >
              {category}
            </Link>
          ))}
        </div>

        {showFeatured && (
          <section className="mt-10 space-y-4">
            <div className="flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Featured</p>
                <h2 className="text-2xl font-semibold text-neutral-950">Popular agent packages</h2>
              </div>
              <span className="text-sm text-neutral-500">Curated MCP templates with explicit auth requirements</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {featuredPresets.map((server) => (
                <ServerCard key={server.id} server={server} href={`/marketplace/${server.id}`} featured />
              ))}
            </div>
          </section>
        )}

        {galleryServers.length === 0 ? (
          <p className="mt-10 rounded-md border bg-white p-6 text-sm text-neutral-600 shadow-sm">No public servers found.</p>
        ) : (
          <section className="mt-10 space-y-4">
            <div className="flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-orange-600">Library</p>
                <h2 className="text-2xl font-semibold text-neutral-950">
                  {selectedCategory === "All" ? "All available servers" : `${selectedCategory} servers`}
                </h2>
              </div>
              <span className="text-sm text-neutral-500">{servers.length} matching listings</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {galleryServers.map((server) => (
                <ServerCard key={server.id} server={server} href={`/marketplace/${server.id}`} />
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
