#!/usr/bin/env bash
# Uses the room of an enlarged boot volume: after the owner raises the size in the Oracle console (Storage > Boot Volumes > Edit), this makes the
# kernel see the new size (rescan), extends the root partition and the ext4 filesystem on it. Called by the updater every cycle; it does nothing
# unless the disk has more than 2 GiB beyond the end of the root partition, so it is safe to repeat. Only ext4 on a plain partition is touched.
# DRY=1 prints what it would do and changes nothing.
set -uo pipefail
. /opt/ttbik/deploy/oracle/agent/common.sh
say() { echo "$(now) $*" >> "$STATE/grow_disk.log"; [ -n "${DRY:-}" ] && echo "$*"; }
ROOT_DEV=$(findmnt -n -o SOURCE / 2>/dev/null) || exit 0
[ -b "$ROOT_DEV" ] || exit 0
[ "$(findmnt -n -o FSTYPE /)" = ext4 ] || exit 0
PART=${ROOT_DEV##*/}
[ -r "/sys/class/block/$PART/partition" ] || exit 0
PARTNUM=$(cat "/sys/class/block/$PART/partition")
DISK=$(lsblk -no PKNAME "$ROOT_DEV" 2>/dev/null | head -1)
[ -n "$DISK" ] && [ -b "/dev/$DISK" ] || exit 0
# make the kernel notice a bigger disk (the same rescan the Oracle console shows after a resize)
if [ -z "${DRY:-}" ]; then
  dd iflag=direct if="/dev/$DISK" of=/dev/null count=1 >/dev/null 2>&1       # the first of the two commands Oracle shows after a resize
  [ -w "/sys/class/block/$DISK/device/rescan" ] && echo 1 > "/sys/class/block/$DISK/device/rescan" 2>/dev/null   # the second
fi
DISK_BYTES=$(blockdev --getsize64 "/dev/$DISK")
PART_END=$(( ($(cat "/sys/class/block/$PART/start") + $(cat "/sys/class/block/$PART/size")) * 512 ))
SPARE=$(( DISK_BYTES - PART_END ))
if [ "$SPARE" -le $((2*1024*1024*1024)) ]; then say "nothing to grow ($ROOT_DEV, $((SPARE/1048576)) MiB beyond the partition)"; exit 0; fi
# the root partition must be the last one on the disk, or there is nothing to extend into
LAST=$(lsblk -nrpo NAME,TYPE "/dev/$DISK" | awk '$2=="part"{print $1}' | while read -r p; do echo "$(cat /sys/class/block/${p##*/}/start) $p"; done | sort -n | tail -1 | cut -d' ' -f2)
[ "$LAST" = "$ROOT_DEV" ] || { say "root partition is not the last one on /dev/$DISK, not touching it"; exit 0; }
command -v growpart >/dev/null 2>&1 || { say "growpart is not installed"; [ -z "${DRY:-}" ] && [ ! -f "$STATE/grow_disk_warned" ] && { touch "$STATE/grow_disk_warned"; tg_notify "القرص كبر لكن أداة growpart غير مثبّتة على الخادم: شغّل sudo apt-get install -y cloud-guest-utils ثم سيمدّد الوكيل القرص وحده."; }; exit 0; }
say "growing $ROOT_DEV (partition $PARTNUM of /dev/$DISK) into $((SPARE/1073741824)) GiB of new space"
[ -n "${DRY:-}" ] && exit 0
BEFORE=$(df -h / | tail -1)
if growpart "/dev/$DISK" "$PARTNUM" >> "$STATE/grow_disk.log" 2>&1 && resize2fs "$ROOT_DEV" >> "$STATE/grow_disk.log" 2>&1; then
  tg_notify "✅ تمدّد قرص Oracle إلى المساحة الجديدة.
قبل: $BEFORE
بعد: $(df -h / | tail -1)"
else
  say "growing failed"; tg_notify "⚠️ تعذّر تمديد قرص Oracle تلقائياً. التفاصيل في $STATE/grow_disk.log على الخادم."
fi
