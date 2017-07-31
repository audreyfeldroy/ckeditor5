/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/**
 * @module typing/deletecommand
 */

import Command from '@ckeditor/ckeditor5-core/src/command';
import Selection from '@ckeditor/ckeditor5-engine/src/model/selection';
import Element from '@ckeditor/ckeditor5-engine/src/model/element';
import Position from '@ckeditor/ckeditor5-engine/src/model/position';
import Range from '@ckeditor/ckeditor5-engine/src/model/range';
import ChangeBuffer from './changebuffer';
import count from '@ckeditor/ckeditor5-utils/src/count';

/**
 * The delete command. Used by the {@link module:typing/delete~Delete delete feature} to handle the <kbd>Delete</kbd> and
 * <kbd>Backspace</kbd> keys.
 *
 * @extends module:core/command~Command
 */
export default class DeleteCommand extends Command {
	/**
	 * Creates an instance of the command.
	 *
	 * @param {module:core/editor/editor~Editor} editor
	 * @param {'forward'|'backward'} direction The directionality of the delete describing in what direction it
	 * should consume the content when the selection is collapsed.
	 */
	constructor( editor, direction ) {
		super( editor );

		/**
		 * The directionality of the delete describing in what direction it should
		 * consume the content when the selection is collapsed.
		 *
		 * @readonly
		 * @member {'forward'|'backward'} #direction
		 */
		this.direction = direction;

		/**
		 * Delete's change buffer used to group subsequent changes into batches.
		 *
		 * @readonly
		 * @private
		 * @member {typing.ChangeBuffer} #buffer
		 */
		this._buffer = new ChangeBuffer( editor.document, editor.config.get( 'typing.undoStep' ) );
	}

	/**
	 * Executes the delete command. Depending on whether the selection is collapsed or not, deletes its content
	 * or a piece of content in the {@link #direction defined direction}.
	 *
	 * @fires execute
	 * @param {Object} [options] The command options.
	 * @param {'character'} [options.unit='character'] See {@link module:engine/controller/modifyselection~modifySelection}'s options.
	 * @param {Number} [options.sequence=1] See the {@link module:engine/view/document~Document#event:delete} event data.
	 */
	execute( options = {} ) {
		const doc = this.editor.document;
		const dataController = this.editor.data;

		doc.enqueueChanges( () => {
			this._buffer.lock();

			const selection = Selection.createFromSelection( doc.selection );

			// Do not replace the whole selected content if selection was collapsed.
			// This prevents such situation:
			//
			// <h1></h1><p>[]</p>	-->  <h1>[</h1><p>]</p> 		-->  <p></p>
			// starting content		-->   after `modifySelection`	-->  after `deleteContent`.
			const doNotResetEntireContent = selection.isCollapsed;

			// Try to extend the selection in the specified direction.
			if ( selection.isCollapsed ) {
				dataController.modifySelection( selection, { direction: this.direction, unit: options.unit } );
			}

			// If selection is still collapsed, then there's nothing to delete.
			if ( selection.isCollapsed ) {
				const sequence = options.sequence || 1;

				if ( this._shouldEntireContentBeReplacedWithParagraph( sequence ) ) {
					this._replaceEntireContentWithParagraph();
				}

				return;
			}

			let changeCount = 0;

			selection.getFirstRange().getMinimalFlatRanges().forEach( range => {
				changeCount += count(
					range.getWalker( { singleCharacters: true, ignoreElementEnd: true, shallow: true } )
				);
			} );

			dataController.deleteContent( selection, this._buffer.batch, { doNotResetEntireContent } );
			this._buffer.input( changeCount );

			doc.selection.setRanges( selection.getRanges(), selection.isBackward );

			this._buffer.unlock();
		} );
	}

	/**
	 * If the user keeps <kbd>Backspace</kbd> or <kbd>Delete</kbd> key, we do nothing because the user can clear
	 * the whole element without removing them.
	 *
	 * But, if the user pressed and released the key, we want to replace the entire content with a paragraph if:
	 *
	 * * the entire content is selected,
	 * * the paragraph is allowed in the common ancestor,
	 * * other paragraph does not occur in the editor.
	 *
	 * @private
	 * @param {Number} sequence A number describing which subsequent delete event it is without the key being released.
	 * @returns {Boolean}
	 */
	_shouldEntireContentBeReplacedWithParagraph( sequence ) {
		// Does nothing if user pressed and held the "Backspace" or "Delete" key.
		if ( sequence > 1 ) {
			return false;
		}

		const document = this.editor.document;
		const selection = document.selection;
		const limitElement = document.schema.getLimitElement( selection );
		const limitStartPosition = Position.createAt( limitElement );
		const limitEndPosition = Position.createAt( limitElement, 'end' );

		if (
			!limitStartPosition.isTouching( selection.getFirstPosition() ) ||
			!limitEndPosition.isTouching( selection.getLastPosition() )
		) {
			return false;
		}

		if ( !document.schema.check( { name: 'paragraph', inside: limitElement.name } ) ) {
			return false;
		}

		// Does nothing if editor already contains an empty paragraph.
		if ( selection.getFirstRange().getCommonAncestor().name === 'paragraph' ) {
			return false;
		}

		return true;
	}

	/**
	 * The entire content is replaced with the paragraph. Selection is moved inside the paragraph.
	 *
	 * @private
	 */
	_replaceEntireContentWithParagraph() {
		const document = this.editor.document;
		const selection = document.selection;
		const limitElement = document.schema.getLimitElement( selection );
		const paragraph = new Element( 'paragraph' );

		this._buffer.batch.remove( Range.createIn( limitElement ) );
		this._buffer.batch.insert( Position.createAt( limitElement ), paragraph );

		selection.collapse( paragraph );
	}
}
