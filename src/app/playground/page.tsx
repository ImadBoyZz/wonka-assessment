import type { Metadata } from "next";
import { Playground } from "@/components/Playground";

export const metadata: Metadata = {
  title: "UISpec Playground",
  description: "Paste an agent definition and watch its validation UI generate live.",
};

export default function PlaygroundPage() {
  return <Playground />;
}
