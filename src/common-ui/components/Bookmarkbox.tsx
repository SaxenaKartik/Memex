import * as React from 'react'
import cx from 'classnames'

const styles = require('./Bookmarkbox.css')

export type CheckboxToggle = (
    event: React.SyntheticEvent<HTMLInputElement>,
) => void

export interface Props {
    id: string
    handleChange: CheckboxToggle
    name?: string
    isChecked: boolean
    isDisabled?: boolean
    children?: React.ReactChild | React.ReactChild[]
}

class Bookmarkbox extends React.PureComponent<Props> {
    render() {
        return (
            <div className={styles.container}>
                <label className={styles.label} htmlFor={this.props.id}>
                    <input
                        className={styles.label__checkbox}
                        type="checkbox"
                        checked={this.props.isChecked}
                        onChange={this.props.handleChange}
                        id={this.props.id}
                        disabled={this.props.isDisabled}
                        name={this.props.name}
                    />
                    <span className={styles.label__text}>
                        <span className={styles.label__check}>
                            <span
                                className={cx(styles.icon, {
                                    [styles.checkedIcon]:
                                        this.props.isChecked === true,
                                })}
                            />
                        </span>
                        {this.props.children}
                    </span>
                </label>
            </div>
        )
    }
}

export default Bookmarkbox
