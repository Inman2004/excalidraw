// Desktop UI icons: Solar, Line Duotone style, bundled locally (no CDN).
// Icons by 480 Design, CC BY 4.0 — attributed in the About dialog.
// One import per icon keeps dev resolution and the bundle small.
import { AddIcon } from "@solar-icons/react/line-duotone/add";
import { CheckCircleIcon } from "@solar-icons/react/line-duotone/check-circle";
import { CloseIcon as SolarCloseIcon } from "@solar-icons/react/line-duotone/close";
import { DangerTriangleIcon } from "@solar-icons/react/line-duotone/danger-triangle";
import { DisketteIcon } from "@solar-icons/react/line-duotone/diskette";
import { DocumentsIcon } from "@solar-icons/react/line-duotone/documents";
import { ExportIcon as SolarExportIcon } from "@solar-icons/react/line-duotone/export";
import { FileCorruptedIcon } from "@solar-icons/react/line-duotone/file-corrupted";
import { FilePenIcon } from "@solar-icons/react/line-duotone/file-pen";
import { FileWarningIcon } from "@solar-icons/react/line-duotone/file-warning";
import { FolderOpenIcon } from "@solar-icons/react/line-duotone/folder-open";
import { HistoryIcon } from "@solar-icons/react/line-duotone/history";
import { ImportIcon as SolarImportIcon } from "@solar-icons/react/line-duotone/import";
import { InfoCircleIcon } from "@solar-icons/react/line-duotone/info-circle";
import { LayersIcon as SolarLayersIcon } from "@solar-icons/react/line-duotone/layers";
import { MonitorIcon } from "@solar-icons/react/line-duotone/monitor";
import { MoonIcon as SolarMoonIcon } from "@solar-icons/react/line-duotone/moon";
import { PinIcon as SolarPinIcon } from "@solar-icons/react/line-duotone/pin";
import { RefreshCircleIcon } from "@solar-icons/react/line-duotone/refresh-circle";
import { RestartIcon } from "@solar-icons/react/line-duotone/restart";
import { SunIcon as SolarSunIcon } from "@solar-icons/react/line-duotone/sun";
import { TrashBinMinimalisticIcon } from "@solar-icons/react/line-duotone/trash-bin-minimalistic";

import { GalleryEditIcon } from "@solar-icons/react/line-duotone/gallery-edit";
import { HeartIcon as SolarHeartIcon } from "@solar-icons/react/line-duotone/heart";
import { HomeSmileIcon } from "@solar-icons/react/line-duotone/home-smile";
import { KeyboardIcon as SolarKeyboardIcon } from "@solar-icons/react/line-duotone/keyboard";
import { PenNewRoundIcon } from "@solar-icons/react/line-duotone/pen-new-round";
import { StarIcon as SolarStarIcon } from "@solar-icons/react/line-duotone/star";

import { MagnifierIcon } from "@solar-icons/react/line-duotone/magnifier";
import { PlayIcon } from "@solar-icons/react/line-duotone/play";
import { ClockCircleIcon } from "@solar-icons/react/line-duotone/clock-circle";
import { Widget4Icon } from "@solar-icons/react/line-duotone/widget-4";
import { LibraryIcon } from "@solar-icons/react/line-duotone/library";
import { ChecklistMinimalisticIcon } from "@solar-icons/react/line-duotone/checklist-minimalistic";
import { CopyIcon } from "@solar-icons/react/line-duotone/copy";
import { SquareTransferHorizontalIcon } from "@solar-icons/react/line-duotone/square-transfer-horizontal";
import { FrameIcon } from "@solar-icons/react/line-duotone/frame";
import { FileSearchIcon } from "@solar-icons/react/line-duotone/file-search";
import { SortVerticalIcon } from "@solar-icons/react/line-duotone/sort-vertical";
import { PenIcon } from "@solar-icons/react/line-duotone/pen";
import { GalleryIcon } from "@solar-icons/react/line-duotone/gallery";
import { TextSquareIcon } from "@solar-icons/react/line-duotone/text-square";

import type { ComponentType } from "react";

export const PlusIcon = AddIcon;
export const CloseIcon = SolarCloseIcon;
export const OpenIcon = FolderOpenIcon;
export const SaveIcon = DisketteIcon;
export const SaveAsIcon = FilePenIcon;
export const ExportIcon = SolarExportIcon;
export const ImportIcon = SolarImportIcon;
export { CloudDownloadIcon as UpdateIcon } from "@solar-icons/react/line-duotone/cloud-download";
export const PinIcon = SolarPinIcon;
export const SunIcon = SolarSunIcon;
export const MoonIcon = SolarMoonIcon;
export const SystemIcon = MonitorIcon;
export const RecentIcon = HistoryIcon;
export const RecoveryIcon = RestartIcon;
export const AutosaveIcon = RefreshCircleIcon;
export const ConflictIcon = FileWarningIcon;
export const ErrorIcon = DangerTriangleIcon;
export const CheckIcon = CheckCircleIcon;
export const TrashIcon = TrashBinMinimalisticIcon;
export const FilesIcon = DocumentsIcon;
export const LayersIcon = SolarLayersIcon;
export const InfoIcon = InfoCircleIcon;
export const MissingIcon = FileCorruptedIcon;
export const HomeIcon = HomeSmileIcon;
export const NewDrawingIcon = PenNewRoundIcon;
export const AnnotateIcon = GalleryEditIcon;
export const SearchIcon = MagnifierIcon;
export const FindAllIcon = FileSearchIcon;
export const PresentIcon = PlayIcon;
export const HistoryClockIcon = ClockCircleIcon;
export const TemplatesIcon = Widget4Icon;
export const LibraryIconD = LibraryIcon;
export const CalloutListIcon = ChecklistMinimalisticIcon;
export const CopyIconD = CopyIcon;
export const SwitchIcon = SquareTransferHorizontalIcon;
export const FramesIcon = FrameIcon;
export const ReorderIcon = SortVerticalIcon;
export const EditIcon = PenIcon;
export const ImageIcon = GalleryIcon;
export const TextIcon = TextSquareIcon;
export const StarIcon = SolarStarIcon;
export const KeyboardIcon = SolarKeyboardIcon;
export const HeartIcon = SolarHeartIcon;

type IconComponent = ComponentType<{
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  secondaryColor?: string;
  secondaryOpacity?: number;
  className?: string;
  "aria-hidden"?: boolean;
}>;

/** 16px (1rem), currentColor in both themes, subtle duotone layer. */
export const Icon = ({
  icon: IconCmp,
  size = 16,
  className,
}: {
  icon: IconComponent;
  size?: number;
  className?: string;
}) => (
  <IconCmp
    size={size}
    color="currentColor"
    strokeWidth={1.5}
    secondaryColor="currentColor"
    secondaryOpacity={0.65}
    className={className}
    aria-hidden
  />
);
