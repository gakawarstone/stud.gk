import { createSignal, createMemo, createEffect, on, onMount, onCleanup, createUniqueId, For, Show, type JSX } from "solid-js";
import { Dynamic, Portal } from "solid-js/web";
import { BookOpen, Braces, BrainCircuit, CodeXml, FlaskConical, Globe, LockKeyhole, Network, PanelsTopLeft, ShieldCheck, Terminal, } from "lucide-solid";
export function courseIcon(title: string) {
    const subject = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
    if (/\blabor?\b|\blab\b|praktikum/.test(subject))
        return FlaskConical;
    if (/krypt|crypt/.test(subject))
        return LockKeyhole;
    if (/sicherheit|security/.test(subject))
        return ShieldCheck;
    if (/kunstliche|artificial|machine learning/.test(subject))
        return BrainCircuit;
    if (/funktional|functional/.test(subject))
        return Braces;
    if (/verteilte|distributed|netzwerk|network/.test(subject))
        return Network;
    if (/web|mobile/.test(subject))
        return Globe;
    if (/software/.test(subject))
        return PanelsTopLeft;
    if (/programmierung|programming|\bawp\b/.test(subject))
        return CodeXml;
    const icons = [BookOpen, Braces, Terminal, Network, PanelsTopLeft, Globe];
    let hash = 0;
    for (const character of subject)
        hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
    return icons[hash % icons.length];
}
