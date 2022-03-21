/**
 * enum representing the different day formats
 * @public
 */
export declare type DayFormat = "2-digit" | "numeric";
/**
 * enum representing the different weekday formats
 * @public
 */
export declare type WeekdayFormat = "long" | "narrow" | "short";
/**
 * enum representing the different month formats
 * @public
 */
export declare type MonthFormat = "2-digit" | "long" | "narrow" | "numeric" | "short";
/**
 * enum representing the different year formats
 * @public
 */
export declare type YearFormat = "2-digit" | "numeric";
/**
 * Date formatting utility
 * @public
 */
export declare class DateFormatter {
    /**
     * Localization settings to use for formatting
     * @public
     */
    locale: string;
    /**
     * Formatting for the day
     * @public
     */
    dayFormat: DayFormat;
    /**
     * Formatting for the weekday labels
     * @public
     */
    weekdayFormat: WeekdayFormat;
    /**
     * Formatting for the month
     * @public
     */
    monthFormat: MonthFormat;
    /**
     * Formatting for the year
     * @public
     */
    yearFormat: YearFormat;
    /**
     * Date used for formatting
     */
    date: Date;
    constructor(config?: {});
    /**
     * Helper function to make sure that the DateFormatter is working with an instance of Date
     * @param date - The date as an object, string or Date insance
     * @returns - A Date instance
     * @public
     */
    getDateObject(date: {
        day: number;
        month: number;
        year: number;
    } | string | Date): Date;
    /**
     *
     * @param date - a valide date as either a Date, string, objec or a DateFormatter
     * @param format - The formatting for the string
     * @param locale - locale data used for formatting
     * @returns A localized string of the date provided
     * @public
     */
    getDate(date?: {
        day: number;
        month: number;
        year: number;
    } | string | Date, format?: Intl.DateTimeFormatOptions, locale?: string): string;
    /**
     *
     * @param day - Day to localize
     * @param format - The formatting for the day
     * @param locale - The locale data used for formatting
     * @returns - A localized number for the day
     * @public
     */
    getDay(day?: number, format?: DayFormat, locale?: string): string;
    /**
     *
     * @param month - The month to localize
     * @param format - The formatting for the month
     * @param locale - The locale data used for formatting
     * @returns - A localized name of the month
     * @public
     */
    getMonth(month?: number, format?: MonthFormat, locale?: string): string;
    /**
     *
     * @param year - The year to localize
     * @param format - The formatting for the year
     * @param locale - The locale data used for formatting
     * @returns - A localized string for the year
     * @public
     */
    getYear(year?: number, format?: YearFormat, locale?: string): string;
    /**
     *
     * @param weekday - The number of the weekday, defaults to Sunday
     * @param format - The formatting for the weekday label
     * @param locale - The locale data used for formatting
     * @returns - A formatted weekday label
     * @public
     */
    getWeekday(weekday?: number, format?: WeekdayFormat, locale?: string): string;
    /**
     *
     * @param format - The formatting for the weekdays
     * @param locale - The locale data used for formatting
     * @returns - An array of the weekday labels
     * @public
     */
    getWeekdays(format?: WeekdayFormat, locale?: string): string[];
}
