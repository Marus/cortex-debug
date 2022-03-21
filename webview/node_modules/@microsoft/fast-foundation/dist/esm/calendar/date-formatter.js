/**
 * Date formatting utility
 * @public
 */
export class DateFormatter {
    constructor(config) {
        /**
         * Formatting for the day
         * @public
         */
        this.dayFormat = "numeric";
        /**
         * Formatting for the weekday labels
         * @public
         */
        this.weekdayFormat = "long";
        /**
         * Formatting for the month
         * @public
         */
        this.monthFormat = "long";
        /**
         * Formatting for the year
         * @public
         */
        this.yearFormat = "numeric";
        /**
         * Date used for formatting
         */
        this.date = new Date();
        /**
         * Add properties on construction
         */
        if (config) {
            for (const key in config) {
                const value = config[key];
                if (key === "date") {
                    this.date = this.getDateObject(value);
                }
                else {
                    this[key] = value;
                }
            }
        }
    }
    /**
     * Helper function to make sure that the DateFormatter is working with an instance of Date
     * @param date - The date as an object, string or Date insance
     * @returns - A Date instance
     * @public
     */
    getDateObject(date) {
        if (typeof date === "string") {
            const dates = date.split(/[/-]/);
            if (dates.length < 3) {
                return new Date();
            }
            return new Date(parseInt(dates[2], 10), parseInt(dates[0], 10) - 1, parseInt(dates[1], 10));
        }
        else if ("day" in date && "month" in date && "year" in date) {
            const { day, month, year } = date;
            return new Date(year, month - 1, day);
        }
        return date;
    }
    /**
     *
     * @param date - a valide date as either a Date, string, objec or a DateFormatter
     * @param format - The formatting for the string
     * @param locale - locale data used for formatting
     * @returns A localized string of the date provided
     * @public
     */
    getDate(date = this.date, format = {
        weekday: this.weekdayFormat,
        month: this.monthFormat,
        day: this.dayFormat,
        year: this.yearFormat,
    }, locale = this.locale) {
        const dateObj = this.getDateObject(date);
        const optionsWithTimeZone = Object.assign({ timeZone: "utc" }, format);
        return new Intl.DateTimeFormat(locale, optionsWithTimeZone).format(dateObj);
    }
    /**
     *
     * @param day - Day to localize
     * @param format - The formatting for the day
     * @param locale - The locale data used for formatting
     * @returns - A localized number for the day
     * @public
     */
    getDay(day = this.date.getDate(), format = this.dayFormat, locale = this.locale) {
        return this.getDate({ month: 1, day, year: 2020 }, { day: format }, locale);
    }
    /**
     *
     * @param month - The month to localize
     * @param format - The formatting for the month
     * @param locale - The locale data used for formatting
     * @returns - A localized name of the month
     * @public
     */
    getMonth(month = this.date.getMonth() + 1, format = this.monthFormat, locale = this.locale) {
        return this.getDate({ month, day: 2, year: 2020 }, { month: format }, locale);
    }
    /**
     *
     * @param year - The year to localize
     * @param format - The formatting for the year
     * @param locale - The locale data used for formatting
     * @returns - A localized string for the year
     * @public
     */
    getYear(year = this.date.getFullYear(), format = this.yearFormat, locale = this.locale) {
        return this.getDate({ month: 2, day: 2, year }, { year: format }, locale);
    }
    /**
     *
     * @param weekday - The number of the weekday, defaults to Sunday
     * @param format - The formatting for the weekday label
     * @param locale - The locale data used for formatting
     * @returns - A formatted weekday label
     * @public
     */
    getWeekday(weekday = 0, format = this.weekdayFormat, locale = this.locale) {
        const date = `1-${weekday + 1}-2017`;
        return this.getDate(date, { weekday: format }, locale);
    }
    /**
     *
     * @param format - The formatting for the weekdays
     * @param locale - The locale data used for formatting
     * @returns - An array of the weekday labels
     * @public
     */
    getWeekdays(format = this.weekdayFormat, locale = this.locale) {
        return Array(7)
            .fill(null)
            .map((_, day) => this.getWeekday(day, format, locale));
    }
}
