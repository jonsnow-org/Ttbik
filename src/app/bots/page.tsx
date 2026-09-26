import type { Metadata } from "next";
import Link from "next/link";
import { isOwnerServer } from "@/lib/isOwner";
import AdSlot from "@/components/AdSlot";
import BotsDeployForm from "./BotsDeployForm";
import { LIVE_BOTS } from "@/lib/liveBots";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/bots";
