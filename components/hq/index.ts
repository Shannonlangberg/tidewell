/*
 * Planted HQ components. Import from "@/components/hq".
 *
 * Most are Server Components. These are Client Components (interactive): AppShell's
 * overlays (CommandPalette, AskPlantedPanel, QuickAdd, MobileMore, ShellProvider, ShellButtons),
 * Drawer, ConfirmDialog, Toast (ToastProvider, useToast, FlashFromSearchParams),
 * SubmitButton and FormSummary. A Client Component file in your own code that needs one
 * of the server-safe ones should import it from its own module, not from this barrel, to
 * keep AppShell out of the client bundle.
 */

export { cx } from "./cx";
export * from "./icons";
export * from "./nav";
export * from "./types";
export * from "./url";
export * from "./flash";

export { AppShell, type AppShellProps } from "./AppShell";
export { Wordmark, type WordmarkProps } from "./Wordmark";
export { useShell } from "./ShellProvider";

export { PageHeader, Breadcrumbs, type PageHeaderProps, type Crumb } from "./PageHeader";
export { Panel, PanelHeader, SectionLabel, Skeleton, SkeletonText, KeyValueList, InlineNote, type KeyValueItem } from "./Primitives";
export { StatBand, Stat, type StatProps } from "./Stat";
export { EmptyState, ErrorState } from "./EmptyState";
export {
  StatusChip,
  RelationshipChip,
  StageChip,
  TaskStatusChip,
  PriorityChip,
  toneForRelationship,
  toneForStage,
  toneForTaskStatus,
  toneForPriority,
  type StatusTone,
  type StatusChipProps,
} from "./StatusChip";
export { Avatar, type AvatarProps } from "./Avatar";

export { Button, LinkButton, IconButton, Spinner, buttonClass, type ButtonProps, type LinkButtonProps, type IconButtonProps, type ButtonVariant, type ButtonSize } from "./Button";
export { SubmitButton, type SubmitButtonProps } from "./SubmitButton";

export { Tabs, type TabItem } from "./Tabs";
export { Pagination, type PaginationProps } from "./Pagination";
export { DataTable, SortHeader, ResponsiveTable, type Column, type DataTableProps, type SortState, type SortDir } from "./DataTable";
export { MobileList, MobileListItem } from "./MobileList";
export { FilterBar } from "./FilterBar";
export { Timeline, TimelineItem } from "./Timeline";

export { Field, FieldError, FormActions, fieldId, fieldError, type FieldProps, type FieldShared, type ControlA11y } from "./Field";
export { TextInput, SearchInput, Textarea, DateInput, type TextInputProps, type TextareaProps, type DateInputProps } from "./TextInput";
export { Select, NativeSelectPicker, type SelectProps, type NativeSelectPickerProps, type SelectOption, type PickerOption } from "./Select";
export { Checkbox, CheckboxGroup, RadioGroup, type CheckboxProps, type CheckboxGroupProps, type RadioGroupProps, type ChoiceOption } from "./Choice";
export { FormSummary, type FormSummaryProps } from "./FormSummary";

export { Drawer, type DrawerProps } from "./Drawer";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { ToastProvider, FlashFromSearchParams, useToast, type ToastTone, type ToastOptions } from "./Toast";
export { CommandPalette } from "./CommandPalette";
export { AskPlantedPanel } from "./AskPlantedPanel";
export { QuickAdd } from "./QuickAdd";
