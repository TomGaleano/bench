import { UnderConstruction } from "../../components/under-construction";

export default function HarnessesPage() {
  return (
    <UnderConstruction
      backHref="/"
      backLabel="overview"
      feature="Harness library"
      blurb="The harness library will let you browse, configure, and version adapters (Pi SDK, SWE-bench, custom evaluators). It isn't ready yet — we wanted to ship the parts you'd use today rather than a half-built version of everything. Come back next week; we'll have the saw down by then."
    />
  );
}
