import type { ViewTemplate } from "@microsoft/fast-element";
import type { FoundationElementTemplate } from "../foundation-element";
import type { ElementDefinitionContext } from "../design-system";
import type { Calendar, CalendarDateInfo, CalendarOptions } from "./calendar";
/**
 * A basic Calendar title template that includes the month and year
 * @returns - A calendar title template
 * @public
 */
export declare const CalendarTitleTemplate: ViewTemplate<Calendar>;
/**
 * Calendar weekday label template
 * @returns - The weekday labels template
 * @public
 */
export declare const calendarWeekdayTemplate: (context: ElementDefinitionContext) => ViewTemplate;
/**
 * A calendar day template
 * @param context - Element definition context for getting the cell tag for calendar-cell
 * @param todayString - A string representation for todays date
 * @returns - A calendar cell template for a given date
 * @public
 */
export declare const calendarCellTemplate: (context: ElementDefinitionContext, todayString: string) => ViewTemplate<CalendarDateInfo>;
/**
 *
 * @param context - Element definition context for getting the cell tag for calendar-cell
 * @param todayString - A string representation for todays date
 * @returns - A template for a week of days
 * @public
 */
export declare const calendarRowTemplate: (context: ElementDefinitionContext, todayString: string) => ViewTemplate;
/**
 * Interactive template using DataGrid
 * @param context - The templates context
 * @param todayString - string representation of todays date
 * @returns - interactive calendar template
 *
 * @internal
 */
export declare const interactiveCalendarGridTemplate: (context: ElementDefinitionContext, todayString: string) => ViewTemplate;
/**
 * Non-interactive calendar template used for a readonly calendar
 * @param todayString - string representation of todays date
 * @returns - non-interactive calendar template
 *
 * @internal
 */
export declare const noninteractiveCalendarTemplate: (todayString: string) => ViewTemplate;
/**
 * The template for the {@link @microsoft/fast-foundation#(Calendar:class)} component.
 *
 * @param context - Element definition context for getting the cell tag for calendar-cell
 * @param definition - Foundation element definition
 * @returns - a template for a calendar month
 * @public
 */
export declare const calendarTemplate: FoundationElementTemplate<ViewTemplate<Calendar>, CalendarOptions>;
