import React, { Component } from 'react'
import ReactDOM from 'react-dom'
import debounce from 'lodash/fp/debounce'
import noop from 'lodash/fp/noop'

import { remoteFunction } from '../../util/webextensionRPC'
import {
    IndexDropdown,
    IndexDropdownNewRow,
    IndexDropdownRow,
} from '../components'
import { ClickHandler } from '../../popup/types'
export interface Props {
    env?: 'inpage' | 'overview'
    source: 'tag' | 'domain'
    /** The URL to use for dis/associating new tags with; set this to keep in sync with index. */
    url?: string
    hover?: boolean
    tabId?: number
    /** Whether the tags are for annotations */
    isForAnnotation?: boolean
    /** Manual flag to display "Add tag" without creating a tag */
    allowAdd?: boolean
    /** Tag Filters that are previously present in the location. */
    initFilters?: string[]
    /** Opt. cb to run when new tag added to state. */
    onFilterAdd?: (filter: string) => void
    /** Opt. cb to run when tag deleted from state. */
    onFilterDel?: (filter: string) => void
    /** Opt. cb with new tag to be added to a new annotation */
    onNewTagAdd?: (filter: string) => void
    setTagDivRef?: (el: HTMLDivElement) => void
    /** initial suggestions from the popup */
    initSuggestions?: string[]
    isForSidebar?: boolean
    isForRibbon?: boolean
    onBackBtnClick?: ClickHandler<HTMLButtonElement>
    allTabs?: boolean
}

export interface State {
    searchVal: string
    isLoading: boolean
    displayFilters: string[]
    filters: string[]
    focused: number
    clearFieldBtn: boolean
    multiEdit: Set<string>
}

class IndexDropdownContainer extends Component<Props, State> {
    static defaultProps: Partial<Props> = {
        onFilterAdd: noop,
        onFilterDel: noop,
        initFilters: [],
        isForAnnotation: false,
        isForRibbon: false,
    }

    private suggestRPC
    private addTagRPC
    private delTagRPC
    private addTagsToOpenTabsRPC
    private delTagsFromOpenTabsRPC
    private processEvent
    private inputEl: HTMLInputElement
    private multiEdit: Set<string>

    constructor(props: Props) {
        super(props)

        this.suggestRPC = remoteFunction('suggest')
        this.addTagRPC = remoteFunction('addTag')
        this.delTagRPC = remoteFunction('delTag')
        this.addTagsToOpenTabsRPC = remoteFunction('addTagsToOpenTabs')
        this.delTagsFromOpenTabsRPC = remoteFunction('delTagsFromOpenTabs')
        this.processEvent = remoteFunction('processEvent')

        if (this.props.isForAnnotation) {
            this.addTagRPC = remoteFunction('addAnnotationTag')
            this.delTagRPC = remoteFunction('delAnnotationTag')
        }

        this.fetchTagSuggestions = debounce(300)(this.fetchTagSuggestions)

        this.state = {
            searchVal: '',
            isLoading: false,
            displayFilters: props.initSuggestions
                ? props.initSuggestions
                : props.initFilters, // Display state objects; will change all the time
            filters: props.initFilters, // Actual tags associated with the page; will only change when DB updates
            focused: props.initFilters.length ? 0 : -1,
            clearFieldBtn: false,
            multiEdit: new Set<string>(),
        }
    }

    componentDidUpdate(prevProps: Props) {
        // Checking for initFilters' length is better as component updates only
        // when a filter is added or deleted, which implies that the length of
        // props.initFilters will differ across two updates.
        if (
            prevProps.initFilters !== undefined &&
            this.props.initFilters !== undefined &&
            prevProps.initFilters.length !== this.props.initFilters.length
        ) {
            this.setState({
                displayFilters: this.props.initSuggestions
                    ? this.props.initSuggestions
                    : this.props.initFilters,
                filters: this.props.initFilters,
            })
        }
    }

    /**
     * Domain inputs need to allow '.' while tags shouldn't.
     */

    /**
     * Decides whether or not to allow index update. Currently determined by `props.url` setting.
     */
    private get allowIndexUpdate() {
        return this.props.url != null
    }

    private showClearfieldBtn() {
        return !this.props.isForSidebar ? false : this.state.clearFieldBtn
    }

    private async storeTrackEvent(isAdded: boolean) {
        const { hover, source } = this.props

        // Make first letter capital
        const sourceType = source.charAt(0).toUpperCase() + source.substr(1)

        // Only for add and remove from the popup or overview, we have already covered filter in overview
        if (this.allowIndexUpdate) {
            if (hover) {
                this.processEvent({
                    type: isAdded ? 'add' + sourceType : 'delete' + sourceType,
                })
            } else {
                this.processEvent({
                    type: isAdded
                        ? 'addPopup' + sourceType
                        : 'deletePopup' + sourceType,
                })
            }
        }
    }
    /**
     * Selector for derived display tags state
     */
    private getDisplayTags() {
        return this.state.displayFilters.map((value, i) => ({
            value,
            active: this.props.allTabs
                ? this.state.multiEdit.has(value)
                : this.pageHasTag(value),
            focused: this.state.focused === i,
        }))
    }

    private pageHasTag = (value: string) => this.state.filters.includes(value)
    private setInputRef = (el: HTMLInputElement) => (this.inputEl = el)

    /**
     * Selector for derived search value/new tag input state
     */
    private getSearchVal() {
        return this.state.searchVal
            .trim()
            .replace(/\s\s+/g, ' ')
            .toLowerCase()
    }

    private canCreateTag() {
        if (!this.allowIndexUpdate && !this.props.allowAdd) {
            return false
        }

        const searchVal = this.getSearchVal()

        return (
            !!searchVal.length &&
            !this.state.displayFilters.reduce(
                (acc, tag) => acc || tag === searchVal,
                false,
            )
        )
    }

    /**
     * Used for 'Enter' presses or 'Add new tag' clicks.
     */
    private addTag = async () => {
        const newTag = this.getSearchVal()

        if (this.allowIndexUpdate) {
            if (this.props.allTabs) {
                this.setState(state => ({
                    multiEdit: state.multiEdit.add(newTag),
                }))
                await this.addTagsToOpenTabsRPC({ name: newTag }).catch(
                    console.error,
                )
            } else {
                await this.addTagRPC({
                    url: this.props.url,
                    tag: newTag,
                    tabId: this.props.tabId,
                }).catch(console.error)
            }
        }
        await this.storeTrackEvent(true)

        this.inputEl.focus()

        // Clear the component state.
        this.setState({
            searchVal: '',
            focused: -1,
            clearFieldBtn: false,
        })

        this.props.onFilterAdd(newTag)
    }

    private async handleSingleTagEdit(tag: string) {
        if (!this.pageHasTag(tag)) {
            if (this.allowIndexUpdate) {
                await this.addTagRPC({
                    url: this.props.url,
                    tag,
                    tabId: this.props.tabId,
                }).catch(console.error)
            }

            await this.storeTrackEvent(true)
            this.props.onFilterAdd(tag)
        } else {
            if (this.allowIndexUpdate) {
                await this.delTagRPC({
                    url: this.props.url,
                    tag,
                    tabId: this.props.tabId,
                }).catch(console.error)
            }

            await this.storeTrackEvent(false)
            this.props.onFilterDel(tag)
        }
    }

    private async handleMultiTagEdit(tag: string) {
        const multiEdit = this.state.multiEdit
        let opPromise: Promise<any>

        if (!multiEdit.has(tag)) {
            multiEdit.add(tag)
            opPromise = this.addTagsToOpenTabsRPC({ name: tag })
        } else {
            multiEdit.delete(tag)
            opPromise = this.delTagsFromOpenTabsRPC({ name: tag })
        }

        // Allow state update to happen optimistically before async stuff is done
        this.setState(() => ({ multiEdit }))
        await opPromise
    }

    /**
     * Used for clicks on displayed tags. Will either add or remove tags to the page
     * depending on their current status as assoc. tags or not.
     */
    private handleTagSelection = (index: number) => async event => {
        const tag = this.state.displayFilters[index]

        if (this.props.allTabs) {
            await this.handleMultiTagEdit(tag)
        } else {
            await this.handleSingleTagEdit(tag)
        }

        this.inputEl.focus()

        // Clear the component state.
        this.setState({
            searchVal: '', // Clear the search field.
            focused: -1,
            clearFieldBtn: false,
        })
    }

    private handleSearchEnterPress(
        event: React.KeyboardEvent<HTMLInputElement>,
    ) {
        event.preventDefault()

        if (
            this.canCreateTag() &&
            this.state.focused === this.state.displayFilters.length
        ) {
            return this.addTag()
        }

        if (this.state.displayFilters.length) {
            return this.handleTagSelection(this.state.focused)(event)
        }

        return null
    }

    private handleSearchArrowPress(
        event: React.KeyboardEvent<HTMLInputElement>,
    ) {
        event.preventDefault()

        // One extra index if the "add new tag" thing is showing
        let offset = this.canCreateTag() ? 0 : 1

        if (!this.allowIndexUpdate) {
            offset = 1
        }

        // Calculate the next focused index depending on current focus and direction
        let focusedReducer
        if (event.key === 'ArrowUp') {
            focusedReducer = focused =>
                focused < 1
                    ? this.state.displayFilters.length - offset
                    : focused - 1
        } else {
            focusedReducer = focused =>
                focused === this.state.displayFilters.length - offset
                    ? 0
                    : focused + 1
        }

        this.setState(state => ({
            ...state,
            focused: focusedReducer(state.focused),
        }))
    }

    handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (
            this.props.env === 'inpage' &&
            (this.props.isForRibbon || this.props.isForAnnotation) &&
            !(event.ctrlKey || event.metaKey) &&
            /[a-zA-Z0-9-_ ]/.test(String.fromCharCode(event.keyCode))
        ) {
            event.preventDefault()
            event.stopPropagation()
            this.setState(state => ({ searchVal: state.searchVal + event.key }), this.fetchTagSuggestions)
            return
        }

        switch (event.key) {
            case 'Enter':
                return this.handleSearchEnterPress(event)
            case 'ArrowUp':
            case 'ArrowDown':
                return this.handleSearchArrowPress(event)
            default:
        }
    }

    private handleSearchChange = (
        event: React.ChangeEvent<HTMLInputElement>,
    ) => {
        const searchVal = event.target.value

        // If user backspaces to clear input, show the list of suggested tags again.
        let displayFilters
        let clearFieldBtn
        if (!searchVal.length) {
            displayFilters = this.props.initSuggestions
                ? this.props.initSuggestions
                : this.props.initFilters
            clearFieldBtn = false
        } else {
            displayFilters = this.state.displayFilters
            clearFieldBtn = true
        }

        this.setState(
            state => ({ ...state, searchVal, displayFilters, clearFieldBtn }),
            this.fetchTagSuggestions, // Debounced suggestion fetch
        )
    }

    clearSearchField = () => {
        this.setState(state => ({
            ...state,
            searchVal: '',
            clearFieldBtn: false,
        }))
    }

    private fetchTagSuggestions = async () => {
        const searchVal = this.getSearchVal()
        if (!searchVal.length) {
            return
        }

        let suggestions = this.state.filters

        try {
            suggestions = await this.suggestRPC(searchVal, this.props.source)
        } catch (err) {
            console.error(err)
        } finally {
            this.setState(state => ({
                ...state,
                displayFilters: suggestions,
                focused: 0,
            }))
        }
    }

    scrollElementIntoViewIfNeeded(domNode: HTMLElement) {
        // Determine if `domNode` fully fits inside `containerDomNode`.
        // If not, set the container's scrollTop appropriately.
        // Below are two ways to do it
        // 1. Element.ScrollIntoView()
        domNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        // 2. Use Element.scrollTop()
        // const parentNode = domNode.parentNode as HTMLElement
        // parentNode.scrollTop = domNode.offsetTop - parentNode.offsetTop
    }

    private renderTags() {
        const tags = this.getDisplayTags()
        const tagOptions = tags.map((tag, i) => (
            <IndexDropdownRow
                {...tag}
                key={i}
                onClick={this.handleTagSelection(i)}
                {...this.props}
                scrollIntoView={this.scrollElementIntoViewIfNeeded}
                isForSidebar={this.props.isForSidebar}
            />
        ))

        if (this.canCreateTag()) {
            tagOptions.unshift(
                <IndexDropdownNewRow
                    key="+"
                    value={this.state.searchVal}
                    onClick={this.addTag}
                    focused={
                        this.state.focused === this.state.displayFilters.length
                    }
                    isForAnnotation={this.props.isForAnnotation}
                    allowAdd={this.props.allowAdd}
                    scrollIntoView={this.scrollElementIntoViewIfNeeded}
                    isForSidebar={this.props.isForSidebar}
                    source={this.props.source}
                />,
            )
        }

        return tagOptions
    }

    render() {
        return (
            <IndexDropdown
                onTagSearchChange={this.handleSearchChange}
                onTagSearchKeyDown={this.handleSearchKeyDown}
                setInputRef={this.setInputRef}
                numberOfTags={
                    this.props.allTabs
                        ? this.state.multiEdit.size
                        : this.state.filters.length
                }
                tags={this.state.filters}
                tagSearchValue={this.state.searchVal}
                clearSearchField={this.clearSearchField}
                showClearfieldBtn={this.showClearfieldBtn()}
                handleTagSelection={this.handleTagSelection}
                {...this.props}
            >
                {this.renderTags()}
            </IndexDropdown>
        )
    }
}

export default IndexDropdownContainer
