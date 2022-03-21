/**
 * Menu items roles.
 * @public
 */
export var MenuItemRole;
(function (MenuItemRole) {
    /**
     * The menu item has a "menuitem" role
     */
    MenuItemRole["menuitem"] = "menuitem";
    /**
     * The menu item has a "menuitemcheckbox" role
     */
    MenuItemRole["menuitemcheckbox"] = "menuitemcheckbox";
    /**
     * The menu item has a "menuitemradio" role
     */
    MenuItemRole["menuitemradio"] = "menuitemradio";
})(MenuItemRole || (MenuItemRole = {}));
/**
 * @internal
 */
export const roleForMenuItem = {
    [MenuItemRole.menuitem]: "menuitem",
    [MenuItemRole.menuitemcheckbox]: "menuitemcheckbox",
    [MenuItemRole.menuitemradio]: "menuitemradio",
};
