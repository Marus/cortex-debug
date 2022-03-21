import { __decorate } from "tslib";
import { attr, nullableNumberConverter, } from "@microsoft/fast-element";
import { keyEnter } from "@microsoft/fast-web-utilities";
import { FoundationElement } from "../foundation-element";
import { DateFormatter } from "./date-formatter";
/**
 * Calendar component
 * @public
 */
export class Calendar extends FoundationElement {
    constructor() {
        super(...arguments);
        /**
         * date formatter utitlity for getting localized strings
         * @public
         */
        this.dateFormatter = new DateFormatter();
        /**
         * Readonly attribute for turning off data-grid
         * @public
         */
        this.readonly = false;
        /**
         * String repesentation of the full locale including market, calendar type and numbering system
         * @public
         */
        this.locale = "en-US";
        /**
         * Month to display
         * @public
         */
        this.month = new Date().getMonth() + 1;
        /**
         * Year of the month to display
         * @public
         */
        this.year = new Date().getFullYear();
        /**
         * Format style for the day
         * @public
         */
        this.dayFormat = "numeric";
        /**
         * Format style for the week day labels
         * @public
         */
        this.weekdayFormat = "short";
        /**
         * Format style for the month label
         * @public
         */
        this.monthFormat = "long";
        /**
         * Format style for the year used in the title
         * @public
         */
        this.yearFormat = "numeric";
        /**
         * Minimum number of weeks to show for the month
         * This can be used to normalize the calendar view
         *  when changing or across multiple calendars
         * @public
         */
        this.minWeeks = 0;
        /**
         * A list of dates that should be shown as disabled
         * @public
         */
        this.disabledDates = "";
        /**
         * A list of dates that should be shown as highlighted
         * @public
         */
        this.selectedDates = "";
        /**
         * The number of miliseconds in a day
         * @internal
         */
        this.oneDayInMs = 86400000;
    }
    localeChanged() {
        this.dateFormatter.locale = this.locale;
    }
    dayFormatChanged() {
        this.dateFormatter.dayFormat = this.dayFormat;
    }
    weekdayFormatChanged() {
        this.dateFormatter.weekdayFormat = this.weekdayFormat;
    }
    monthFormatChanged() {
        this.dateFormatter.monthFormat = this.monthFormat;
    }
    yearFormatChanged() {
        this.dateFormatter.yearFormat = this.yearFormat;
    }
    /**
     * Gets data needed to render about a calendar month as well as the previous and next months
     * @param year - year of the calendar
     * @param month - month of the calendar
     * @returns - an object with data about the current and 2 surrounding months
     * @public
     */
    getMonthInfo(month = this.month, year = this.year) {
        const getFirstDay = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();
        const getLength = (date) => {
            const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
            return new Date(nextMonth.getTime() - this.oneDayInMs).getDate();
        };
        const thisMonth = new Date(year, month - 1);
        const nextMonth = new Date(year, month);
        const previousMonth = new Date(year, month - 2);
        return {
            length: getLength(thisMonth),
            month,
            start: getFirstDay(thisMonth),
            year,
            previous: {
                length: getLength(previousMonth),
                month: previousMonth.getMonth() + 1,
                start: getFirstDay(previousMonth),
                year: previousMonth.getFullYear(),
            },
            next: {
                length: getLength(nextMonth),
                month: nextMonth.getMonth() + 1,
                start: getFirstDay(nextMonth),
                year: nextMonth.getFullYear(),
            },
        };
    }
    /**
     * A list of calendar days
     * @param info - an object containing the information needed to render a calendar month
     * @param minWeeks - minimum number of weeks to show
     * @returns a list of days in a calendar month
     * @public
     */
    getDays(info = this.getMonthInfo(), minWeeks = this.minWeeks) {
        minWeeks = minWeeks > 10 ? 10 : minWeeks;
        const { start, length, previous, next } = info;
        const days = [];
        let dayCount = 1 - start;
        while (dayCount < length + 1 ||
            days.length < minWeeks ||
            days[days.length - 1].length % 7 !== 0) {
            const { month, year } = dayCount < 1 ? previous : dayCount > length ? next : info;
            const day = dayCount < 1
                ? previous.length + dayCount
                : dayCount > length
                    ? dayCount - length
                    : dayCount;
            const dateString = `${month}-${day}-${year}`;
            const disabled = this.dateInString(dateString, this.disabledDates);
            const selected = this.dateInString(dateString, this.selectedDates);
            const date = {
                day,
                month,
                year,
                disabled,
                selected,
            };
            const target = days[days.length - 1];
            if (days.length === 0 || target.length % 7 === 0) {
                days.push([date]);
            }
            else {
                target.push(date);
            }
            dayCount++;
        }
        return days;
    }
    /**
     * A helper function that checks if a date exists in a list of dates
     * @param date - A date objec that includes the day, month and year
     * @param datesString - a comma separated list of dates
     * @returns - Returns true if it found the date in the list of dates
     * @public
     */
    dateInString(date, datesString) {
        const dates = datesString.split(",").map(str => str.trim());
        date =
            typeof date === "string"
                ? date
                : `${date.getMonth() + 1}-${date.getDate()}-${date.getFullYear()}`;
        return dates.some(d => d === date);
    }
    /**
     * Creates a class string for the day container
     * @param date - date of the calendar cell
     * @returns - string of class names
     * @public
     */
    getDayClassNames(date, todayString) {
        const { day, month, year, disabled, selected } = date;
        const today = todayString === `${month}-${day}-${year}`;
        const inactive = this.month !== month;
        return [
            "day",
            today && "today",
            inactive && "inactive",
            disabled && "disabled",
            selected && "selected",
        ]
            .filter(Boolean)
            .join(" ");
    }
    /**
     * Returns a list of weekday labels
     * @returns An array of weekday text and full text if abbreviated
     * @public
     */
    getWeekdayText() {
        const weekdayText = this.dateFormatter.getWeekdays().map(text => ({ text }));
        if (this.weekdayFormat !== "long") {
            const longText = this.dateFormatter.getWeekdays("long");
            weekdayText.forEach((weekday, index) => {
                weekday.abbr = longText[index];
            });
        }
        return weekdayText;
    }
    /**
     * Emits the "date-select" event with the day, month and year.
     * @param date - Date cell
     * @public
     */
    handleDateSelect(event, day) {
        event.preventDefault;
        this.$emit("dateselected", day);
    }
    /**
     * Handles keyboard events on a cell
     * @param event - Keyboard event
     * @param date - Date of the cell selected
     */
    handleKeydown(event, date) {
        if (event.key === keyEnter) {
            this.handleDateSelect(event, date);
        }
        return true;
    }
}
__decorate([
    attr({ mode: "boolean" })
], Calendar.prototype, "readonly", void 0);
__decorate([
    attr
], Calendar.prototype, "locale", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], Calendar.prototype, "month", void 0);
__decorate([
    attr({ converter: nullableNumberConverter })
], Calendar.prototype, "year", void 0);
__decorate([
    attr({ attribute: "day-format", mode: "fromView" })
], Calendar.prototype, "dayFormat", void 0);
__decorate([
    attr({ attribute: "weekday-format", mode: "fromView" })
], Calendar.prototype, "weekdayFormat", void 0);
__decorate([
    attr({ attribute: "month-format", mode: "fromView" })
], Calendar.prototype, "monthFormat", void 0);
__decorate([
    attr({ attribute: "year-format", mode: "fromView" })
], Calendar.prototype, "yearFormat", void 0);
__decorate([
    attr({ attribute: "min-weeks", converter: nullableNumberConverter })
], Calendar.prototype, "minWeeks", void 0);
__decorate([
    attr({ attribute: "disabled-dates" })
], Calendar.prototype, "disabledDates", void 0);
__decorate([
    attr({ attribute: "selected-dates" })
], Calendar.prototype, "selectedDates", void 0);
