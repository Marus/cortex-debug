import { SyntheticViewTemplate } from "@microsoft/fast-element";
import type { StartEndOptions } from "..";
import { FoundationElement } from "../foundation-element";
import type { FoundationElementDefinition, FoundationElementTemplate } from "../foundation-element";
import type { DayFormat, MonthFormat, WeekdayFormat, YearFormat } from "./date-formatter";
import { DateFormatter } from "./date-formatter";
/**
 * Information about a month
 * @public
 */
export declare type MonthInfo = {
    month: number;
    year: number;
    length: number;
    start: number;
};
/**
 * Calendar information needed for rendering
 * including the next and previous months
 * @public
 */
export declare type CalendarInfo = MonthInfo & {
    previous: MonthInfo;
    next: MonthInfo;
};
/**
 * Caldendar date info
 * used to represent a date
 * @public
 */
export declare type CalendarDateInfo = {
    day: number;
    month: number;
    year: number;
    disabled?: boolean;
    selected?: boolean;
};
/**
 * Calendar configuration options
 * @public
 */
export declare type CalendarOptions = FoundationElementDefinition & StartEndOptions & {
    title?: FoundationElementTemplate<SyntheticViewTemplate<any, Calendar>, CalendarOptions> | SyntheticViewTemplate | string;
};
/**
 * Calendar component
 * @public
 */
export declare class Calendar extends FoundationElement {
    /**
     * date formatter utitlity for getting localized strings
     * @public
     */
    dateFormatter: DateFormatter;
    /**
     * Readonly attribute for turning off data-grid
     * @public
     */
    readonly: boolean;
    /**
     * String repesentation of the full locale including market, calendar type and numbering system
     * @public
     */
    locale: string;
    private localeChanged;
    /**
     * Month to display
     * @public
     */
    month: number;
    /**
     * Year of the month to display
     * @public
     */
    year: number;
    /**
     * Format style for the day
     * @public
     */
    dayFormat: DayFormat;
    private dayFormatChanged;
    /**
     * Format style for the week day labels
     * @public
     */
    weekdayFormat: WeekdayFormat;
    private weekdayFormatChanged;
    /**
     * Format style for the month label
     * @public
     */
    monthFormat: MonthFormat;
    private monthFormatChanged;
    /**
     * Format style for the year used in the title
     * @public
     */
    yearFormat: YearFormat;
    private yearFormatChanged;
    /**
     * Minimum number of weeks to show for the month
     * This can be used to normalize the calendar view
     *  when changing or across multiple calendars
     * @public
     */
    minWeeks: number;
    /**
     * A list of dates that should be shown as disabled
     * @public
     */
    disabledDates: string;
    /**
     * A list of dates that should be shown as highlighted
     * @public
     */
    selectedDates: string;
    /**
     * The number of miliseconds in a day
     * @internal
     */
    private oneDayInMs;
    /**
     * Gets data needed to render about a calendar month as well as the previous and next months
     * @param year - year of the calendar
     * @param month - month of the calendar
     * @returns - an object with data about the current and 2 surrounding months
     * @public
     */
    getMonthInfo(month?: number, year?: number): CalendarInfo;
    /**
     * A list of calendar days
     * @param info - an object containing the information needed to render a calendar month
     * @param minWeeks - minimum number of weeks to show
     * @returns a list of days in a calendar month
     * @public
     */
    getDays(info?: CalendarInfo, minWeeks?: number): CalendarDateInfo[][];
    /**
     * A helper function that checks if a date exists in a list of dates
     * @param date - A date objec that includes the day, month and year
     * @param datesString - a comma separated list of dates
     * @returns - Returns true if it found the date in the list of dates
     * @public
     */
    dateInString(date: Date | string, datesString: string): boolean;
    /**
     * Creates a class string for the day container
     * @param date - date of the calendar cell
     * @returns - string of class names
     * @public
     */
    getDayClassNames(date: CalendarDateInfo, todayString?: string): string;
    /**
     * Returns a list of weekday labels
     * @returns An array of weekday text and full text if abbreviated
     * @public
     */
    getWeekdayText(): {
        text: string;
        abbr?: string;
    }[];
    /**
     * Emits the "date-select" event with the day, month and year.
     * @param date - Date cell
     * @public
     */
    handleDateSelect(event: Event, day: CalendarDateInfo): void;
    /**
     * Handles keyboard events on a cell
     * @param event - Keyboard event
     * @param date - Date of the cell selected
     */
    handleKeydown(event: KeyboardEvent, date: CalendarDateInfo): boolean;
}
