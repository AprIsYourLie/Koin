import type { Metadata } from "next";
import KoinApp from "./KoinApp";

export const metadata: Metadata = {
  title: "Koin · 看清每个月的钱花在哪里",
  description: "本机优先的个人消费账本，支持账单导入、自动去重与花呗消费识别。",
};

export default function Home() {
  return <KoinApp />;
}
